// Authored boundaries and contracts are fixed before either model sees the task.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inventory, copyInventory, readJson, saveJson, hash } from '../src/platform/files.mjs';
import { analyze } from '../src/providers/javascript/analyze.mjs';
const base = path.resolve('.portsmith/index-bench');
await fs.mkdir(base, { recursive: true });
const root = await fs.mkdtemp(path.join(base, 'setup-')),
  source = path.join(root, 'source'),
  target = path.join(root, 'target');
const upstream = path.resolve('.portsmith/complex-bench/repos/minisearch');
const prior = await readJson('.portsmith/complex-bench/drawdb-latest.json');
// Upstream demo data uses symlinks, unsupported by Portsmith snapshots. Preserve and
// record the complete original Git state; scope the source copy to its library.
const sourceGitState = execFileSync('git', ['status', '--porcelain'], { cwd: upstream, encoding: 'utf8' });
const sourceInventory = await inventory(path.join(upstream, 'src'));
const projected = Object.fromEntries(
  Object.entries(sourceInventory).map(([file, value]) => ['src/' + file, value])
);
for (const file of ['package.json', 'tsconfig.json', 'LICENSE.txt'])
  projected[file] = { sha256: hash(await fs.readFile(path.join(upstream, file))), executable: false };
const targetInventory = await inventory(path.join(prior.run, 'baseline'));
await copyInventory(upstream, source, projected);
await copyInventory(path.join(prior.run, 'baseline'), target, targetInventory);
const entry = 'portsmith-index.mjs',
  targetEntry = 'src/utils/indexSearch.js',
  component = 'src/components/EditorSidePanel/TablesTab/SearchBar.jsx';
await saveJson(path.join(source, 'portsmith.aliases.json'), {
  compilerOptions: { paths: { '@engine': ['src/MiniSearch.ts'] } }
});
const helper = `export function matchTreeNode(query,node) { if (!query) return true; if(typeof node?.label!=='string') return false; return searchSequence([{id:'node',title:node.label,body:''}],[{type:'search',query}])[0].length>0; }\n`;
await fs.writeFile(
  path.join(source, entry),
  `// Authored JSON boundary; the original MiniSearch implementation is unchanged.\nimport MiniSearch from '@engine';
export function searchSequence(documents,operations) {
 const index=new MiniSearch({fields:['title','body'],autoVacuum:false,searchOptions:{prefix:true,fuzzy:0.2,combineWith:'AND'}});index.addAll(documents);
 const ids=new Set(documents.map(d=>d.id)),results=[];
 for(const op of operations) {
  if(op.type==='add'){index.add(op.document);ids.add(op.document.id);}
  else if(op.type==='replace'){index.replace(op.document);}
  else if(op.type==='remove'){index.discard(op.id);ids.delete(op.id);}
  else if(op.type==='search') results.push((op.query.trim()?index.search(op.query).map(r=>r.id):[...ids]).sort());
  else throw Error('Unsupported operation');
 }return results;
}\n` + helper
);
await saveJson(path.join(target, 'portsmith.aliases.json'), {
  compilerOptions: { paths: { '@app/*': ['src/*'] } }
});
await fs.writeFile(
  path.join(target, targetEntry),
  `export function searchSequence(documents,operations) {
 const docs=new Map(documents.map(d=>[d.id,{...d}])),results=[];
 for(const op of operations) {
  if(op.type==='add'||op.type==='replace') docs.set(op.document.id,{...op.document});
  else if(op.type==='remove') docs.delete(op.id);
  else if(op.type==='search') results.push([...docs.values()].filter(d=>(d.title+' '+d.body).toLowerCase().includes(op.query.trim().toLowerCase())).map(d=>d.id).sort());
  else throw Error('Unsupported operation');
 }return results;
}\n` + helper
);
let jsx = await fs.readFile(path.join(target, component), 'utf8');
jsx =
  `import {matchTreeNode} from '@app/utils/indexSearch.js';\n` +
  jsx.replace(
    '      filterTreeNode\n',
    '      filterTreeNode={(query,_label,node)=>matchTreeNode(query,node)}\n'
  );
await fs.writeFile(path.join(target, component), jsx);
const vite = path.join(target, 'vite.config.js');
await fs.writeFile(
  vite,
  (await fs.readFile(vite, 'utf8')).replace(
    '  plugins:',
    "  resolve: { alias: { '@app': new URL('./src', import.meta.url).pathname } },\n  plugins:"
  )
);
const docs = [
  { id: 'a', title: 'customers', body: 'account balance' },
  { id: 'b', title: 'invoices', body: 'payment deadline' },
  { id: 'c', title: 'transactions', body: 'account ledger' }
];
const cases = [];
function add(name, documents, operations, expected) {
  cases.push({ name, sourceArgs: [documents, operations], targetArgs: [documents, operations], expected });
}
for (const [query, ids] of [
  ['customers', ['a']],
  ['CUSTOMERS', ['a']],
  ['custmers', ['a']],
  ['cust', ['a']],
  ['account', ['a', 'c']],
  ['acount', ['a', 'c']],
  ['account ledg', ['c']],
  ['ledgr', ['c']],
  ['payment inv', ['b']],
  ['inv payment', ['b']],
  ['transactons', ['c']],
  ['pay', ['b']],
  ['zzzzzz', []],
  ['', ['a', 'b', 'c']],
  ['  ', ['a', 'b', 'c']],
  ['balance payment', []],
  ['customer account', ['a']],
  ['account customers', ['a']]
])
  add('query ' + JSON.stringify(query), docs, [{ type: 'search', query }], [ids]);
add(
  'remove indexed record',
  docs,
  [
    { type: 'remove', id: 'a' },
    { type: 'search', query: 'account' },
    { type: 'search', query: 'cust' }
  ],
  [['c'], []]
);
add(
  'replace removes old terms',
  docs,
  [
    { type: 'replace', document: { id: 'a', title: 'products', body: 'inventory stock' } },
    { type: 'search', query: 'customers' },
    { type: 'search', query: 'inventry' },
    { type: 'search', query: 'account' }
  ],
  [[], ['a'], ['c']]
);
add(
  'add searchable document',
  docs,
  [
    { type: 'add', document: { id: 'd', title: 'shipments', body: 'dispatch warehouse' } },
    { type: 'search', query: 'ship' },
    { type: 'search', query: 'warehuse' }
  ],
  [['d'], ['d']]
);
add(
  'discard then reuse id',
  docs,
  [
    { type: 'remove', id: 'a' },
    { type: 'add', document: { id: 'a', title: 'products', body: 'stock' } },
    { type: 'search', query: 'cust' },
    { type: 'search', query: 'prod' }
  ],
  [[], ['a']]
);
add(
  'empty index',
  [],
  [
    { type: 'search', query: 'anything' },
    { type: 'search', query: '' }
  ],
  [[], []]
);
add(
  'multi update',
  docs,
  [
    { type: 'replace', document: { id: 'a', title: 'products', body: 'stock' } },
    { type: 'replace', document: { id: 'a', title: 'warehouses', body: 'inventory' } },
    { type: 'search', query: 'stock' },
    { type: 'search', query: 'wareh' },
    { type: 'remove', id: 'a' },
    { type: 'search', query: 'wareh' }
  ],
  [[], ['a'], []]
);
add(
  'empty after remove',
  [{ id: 'a', title: 'one', body: '' }],
  [
    { type: 'remove', id: 'a' },
    { type: 'search', query: '' }
  ],
  [[]]
);
add(
  'cross-field AND',
  docs,
  [
    { type: 'search', query: 'deadline invoice' },
    { type: 'search', query: 'customer ledger' }
  ],
  [['b'], []]
);
await fs.writeFile(
  path.join(target, 'test/index-regression.test.mjs'),
  `import {test} from 'node:test';import assert from 'node:assert/strict';import {searchSequence,matchTreeNode} from '@app/utils/indexSearch.js';
const docs=${JSON.stringify(docs)};
for(const d of docs)test('exact '+d.id,()=>assert.deepEqual(searchSequence(docs,[{type:'search',query:d.title}]),[[d.id]]));
test('empty query',()=>assert.deepEqual(searchSequence(docs,[{type:'search',query:''}]),[['a','b','c']]));
test('remove',()=>assert.deepEqual(searchSequence(docs,[{type:'remove',id:'a'},{type:'search',query:'customers'}]),[[]]));
test('replace',()=>assert.deepEqual(searchSequence(docs,[{type:'replace',document:{id:'a',title:'products',body:''}},{type:'search',query:'customers'},{type:'search',query:'products'}]),[[],['a']]));
test('add',()=>assert.deepEqual(searchSequence(docs,[{type:'add',document:{id:'d',title:'products',body:''}},{type:'search',query:'products'}]),[['d']]));
test('input unchanged',()=>{const before=JSON.stringify(docs);searchSequence(docs,[{type:'remove',id:'a'}]);assert.equal(JSON.stringify(docs),before)});
test('unrelated query',()=>assert.deepEqual(searchSequence(docs,[{type:'search',query:'zzzzzz'}]),[[]]));
test('missing label',()=>assert.equal(matchTreeNode('one',{}),false));
test('empty tree query',()=>assert.equal(matchTreeNode('',{}),true));
test('exact tree query',()=>assert.equal(matchTreeNode('account_id',{label:'account_id'}),true));
`
);
const node = path.resolve('.portsmith/complex-bench/runtime/node_modules/node-bin-darwin-arm64/bin/node');
const contract = {
  version: 1,
  source: { module: entry, export: 'searchSequence' },
  target: { module: targetEntry, export: 'searchSequence' },
  runtime: { aliases: true },
  cases,
  regression: {
    command: node,
    args: ['--test', 'test/portsmith-regression.test.mjs', 'test/index-regression.test.mjs']
  },
  checks: [
    {
      name: 'Full upstream production build',
      command: node,
      args: ['node_modules/vite/bin/vite.js', 'build']
    }
  ]
};
await saveJson(path.join(root, 'contract.json'), contract);
await saveJson(path.join(root, 'model.json'), {
  ...(await readJson(prior.config)),
  contextFiles: [targetEntry, component],
  maxContextBytes: 1000000
});
const analysis = await analyze({ source, target, entry, aliases: true });
await saveJson(path.join(root, 'analysis.json'), analysis);
if (analysis.blockers.length) throw Error(analysis.blockers.join('\n'));
const record = {
  root,
  source,
  target,
  entry,
  targetEntry,
  component,
  contract: path.join(root, 'contract.json'),
  config: path.join(root, 'model.json'),
  mount: 'src/features/minisearch',
  originalSource: upstream,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim(),
  sourceInventory: projected,
  sourceGitState,
  targetInventory,
  sourceFiles: analysis.files.length,
  notes: [
    'Source projection omits upstream examples with symlinked demo data; all library source copied unchanged.',
    'Original MiniSearch files unchanged; callable bridge and source alias are authored.',
    'Destination alias mapping and Vite alias are authored before freezing the contract.',
    'DrawDB has no upstream suite: 13 previous authored regressions plus 12 new ones.',
    'Stateful callable index behavior and fuzzy UI integration are tested separately.'
  ]
};
await saveJson(path.join(root, 'setup.json'), record);
await saveJson(path.join(base, 'setup-latest.json'), record);
console.log(root, analysis.files.length, cases.length);
