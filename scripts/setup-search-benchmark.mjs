// Reproducible preparation only: preserves originals and declares all tests before proposals.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inventory, copyInventory, readJson, saveJson } from '../src/platform/files.mjs';
import { analyze } from '../src/providers/javascript/analyze.mjs';
const base = path.resolve('.portsmith/search-bench');
await fs.mkdir(base, { recursive: true });
const root = await fs.mkdtemp(path.join(base, 'setup-'));
const source = path.join(root, 'source'),
  target = path.join(root, 'target');
const upstream = path.resolve('.portsmith/complex-bench/repos/fuse');
const prior = await readJson('.portsmith/complex-bench/drawdb-latest.json');
const sourceInventory = await inventory(upstream);
const targetInventory = await inventory(path.join(prior.run, 'baseline'));
await copyInventory(upstream, source, sourceInventory);
await copyInventory(path.join(prior.run, 'baseline'), target, targetInventory);
const entry = 'portsmith-search.mjs',
  targetEntry = 'src/utils/tableSearch.js';
const component = 'src/components/EditorSidePanel/TablesTab/SearchBar.jsx';
await fs.writeFile(
  path.join(source, entry),
  `// Authored callable boundary; original Fuse source is unchanged.\nimport Fuse from './src/core/index.js';\nexport function matchTreeNode(query, node) {\n  if (!query) return true;\n  if (typeof node?.label !== 'string') return false;\n  return new Fuse([node.label], { threshold: 0.3, ignoreLocation: true, ignoreDiacritics: true }).search(query).length > 0;\n}\n`
);
// Extract Semi UI's existing case-insensitive label substring predicate into a callable boundary.
await fs.writeFile(
  path.join(target, targetEntry),
  `export function matchTreeNode(query, node) {\n  if (!query) return true;\n  return typeof node?.label === 'string' && node.label.toLowerCase().includes(query.toLowerCase());\n}\n`
);
let jsx = await fs.readFile(path.join(target, component), 'utf8');
jsx =
  `import { matchTreeNode } from '../../../utils/tableSearch.js';\n` +
  jsx.replace(
    '      filterTreeNode\n',
    '      filterTreeNode={(query, _label, node) => matchTreeNode(query, node)}\n'
  );
await fs.writeFile(path.join(target, component), jsx);
const positive = [
  ['customers', 'customers'],
  ['CUSTOMERS', 'customers'],
  ['customer', 'customers'],
  ['custmers', 'customers'],
  ['cutomers', 'customers'],
  ['custmoers', 'customers'],
  ['account_id', 'account_id'],
  ['acount_id', 'account_id'],
  ['transactons', 'transactions'],
  ['invoice', 'invoices'],
  ['cafe', 'café'],
  ['resume', 'résumé'],
  ['order', 'purchase_order'],
  ['customer_account_transactions_2026', 'customer_account_transactions_2026'],
  ['customer_account_transactons_2026', 'customer_account_transactions_2026']
];
const negative = [
  ['zzzzzzzz', 'customers'],
  ['products', 'customers'],
  ['orders', 'transactions'],
  ['account', ''],
  ['abcdef', 'xyzuvw']
];
const cases = [
  ...positive.map(([q, label]) => ({ q, label, expected: true })),
  ...negative.map(([q, label]) => ({ q, label, expected: false })),
  { q: '', label: 'anything', expected: true },
  { q: 'account', label: 42, expected: false }
].map(({ q, label, expected }, i) => ({
  name: `search-${i + 1}: ${q} / ${label}`,
  sourceArgs: [q, { label }],
  targetArgs: [q, { label }],
  expected
}));
await fs.writeFile(
  path.join(target, 'test/search-regression.test.mjs'),
  `import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {matchTreeNode} from '../src/utils/tableSearch.js';\nfor (const label of ['customers','account_id','purchase_order','invoice_line','résumé','schema.table']) test('exact '+label,()=>assert.equal(matchTreeNode(label,{label}),true));\ntest('empty query includes all nodes',()=>assert.equal(matchTreeNode('',{}),true));\ntest('missing labels cannot match',()=>assert.equal(matchTreeNode('customer',{}),false));\ntest('input data unchanged',()=>{const node={label:'customers',children:[{label:'account_id'}]};const before=JSON.stringify(node);matchTreeNode('customers',node);assert.equal(JSON.stringify(node),before)});\n`
);
const node = path.resolve('.portsmith/complex-bench/runtime/node_modules/node-bin-darwin-arm64/bin/node');
const contract = {
  version: 1,
  source: { module: entry, export: 'matchTreeNode' },
  target: { module: targetEntry, export: 'matchTreeNode' },
  runtime: { relativeImports: true },
  cases,
  regression: {
    command: node,
    args: ['--test', 'test/portsmith-regression.test.mjs', 'test/search-regression.test.mjs']
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
const config = {
  ...(await readJson(prior.config)),
  contextFiles: [targetEntry, component],
  maxContextBytes: 1000000
};
await saveJson(path.join(root, 'model.json'), config);
const analysis = await analyze({ source, target, entry });
if (analysis.blockers.length) throw Error(analysis.blockers.join('\n'));
await saveJson(path.join(root, 'analysis.json'), analysis);
const record = {
  root,
  source,
  target,
  entry,
  targetEntry,
  component,
  contract: path.join(root, 'contract.json'),
  config: path.join(root, 'model.json'),
  mount: 'src/features/fuse-search',
  dependencies: await fs.realpath(path.join(prior.run, 'baseline/node_modules')),
  originalSource: upstream,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim(),
  sourceInventory,
  targetInventory,
  sourceFiles: analysis.files.length,
  notes: [
    'Baseline search predicate extracted from Semi UI substring behavior; original app untouched.',
    'Authored source callable bridge and nine new regression tests. Existing 13 authored app regressions retained; drawDB has no upstream suite.',
    'Original 34 Fuse files are immutable. Only fuzzy string search exercised; no claim for every Fuse mode.'
  ]
};
await saveJson(path.join(root, 'setup.json'), record);
await saveJson(path.join(base, 'setup-latest.json'), record);
console.log(root, analysis.files.length, cases.length);
