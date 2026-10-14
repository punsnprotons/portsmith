import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inventory, copyInventory, saveJson, readJson, hash } from '../src/platform/files.mjs';
import { analyze } from '../src/providers/javascript/analyze.mjs';
const base = path.resolve('.portsmith/workspace-bench'),
  root = await fs.mkdtemp(path.join(base, 'setup-')),
  source = path.join(root, 'source'),
  target = path.join(root, 'target'),
  original = path.join(base, 'repos/zod');
const tracked = execFileSync('git', ['ls-files', '-s', '-z'], { cwd: original, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean),
  projected = {},
  omitted = [];
for (const line of tracked) {
  const [header, file] = line.split('\t');
  if (header.startsWith('120000')) {
    omitted.push(file);
    continue;
  }
  if (
    file
      .split('/')
      .some(
        (p) => p === '.git' || p === 'node_modules' || p === 'dist' || p === 'build' || p.startsWith('.env')
      )
  )
    continue;
  const bytes = await fs.readFile(path.join(original, file));
  projected[file] = { sha256: hash(bytes), executable: header.startsWith('100755') };
}
await copyInventory(original, source, projected);
const prior = await readJson('.portsmith/complex-bench/mermaid-live-editor-latest.json');
await copyInventory(
  path.join(prior.run, 'baseline'),
  target,
  await inventory(path.join(prior.run, 'baseline'))
);
const entry = 'portsmith-state.mjs',
  targetEntry = 'src/lib/util/stateValidation.ts',
  consumer = 'src/lib/util/serde.ts';
await fs.writeFile(
  path.join(source, entry),
  `// Authored boundary using original Zod schemas, parser and validators.\nimport {looseObject,string,boolean,number,object} from './packages/zod/src/v4/classic/index.ts';
const config=string().refine(text=>{try{const value=JSON.parse(text);return value!==null&&typeof value==='object'&&!Array.isArray(value);}catch{return false;}});
const schema=looseObject({code:string(),mermaid:config,rough:boolean().optional(),updateDiagram:boolean().optional(),grid:boolean().optional(),panZoom:boolean().optional(),pan:object({x:number(),y:number()}).optional(),zoom:number().optional()});
export function isValidSharedState(value){return schema.safeParse(value).success;}
`
);
await fs.writeFile(
  path.join(target, targetEntry),
  `export function isValidSharedState(value:unknown):boolean { return value!==null && typeof value==='object' && !Array.isArray(value); }\n`
);
const originalSerde = await fs.readFile(path.join(target, consumer), 'utf8');
await fs.writeFile(
  path.join(target, consumer),
  `import {isValidSharedState} from '$lib/util/stateValidation';\n` +
    originalSerde.replace(
      '  return JSON.parse(json) as State;',
      "  const value: unknown = JSON.parse(json);\n  if (!isValidSharedState(value)) throw new Error('Invalid shared diagram state');\n  return value as State;"
    )
);
const valid = { code: 'flowchart TD\nA-->B', mermaid: '{}' };
const cases = [];
function add(name, value, expected) {
  cases.push({ name, sourceArgs: [value], targetArgs: [value], expected });
}
add('legacy minimal', valid, true);
add(
  'all controls',
  {
    ...valid,
    rough: false,
    updateDiagram: true,
    grid: true,
    panZoom: false,
    pan: { x: 2, y: -5 },
    zoom: 1.25
  },
  true
);
add('unicode', { code: 'flowchart TD\nA[日本語😀]', mermaid: '{"theme":"dark"}' }, true);
add('future fields preserved', { ...valid, future: { nested: ['v', 1] } }, true);
add('empty code', { code: '', mermaid: '{}' }, true);
for (const [name, value] of [
  ['null', null],
  ['array', []],
  ['number', 4],
  ['empty object', {}],
  ['missing code', { mermaid: '{}' }],
  ['code wrong type', { ...valid, code: 7 }],
  ['missing config', { code: 'a' }],
  ['config wrong type', { ...valid, mermaid: {} }],
  ['config bad json', { ...valid, mermaid: 'oops' }],
  ['config array', { ...valid, mermaid: '[]' }],
  ['config null', { ...valid, mermaid: 'null' }],
  ...['rough', 'updateDiagram', 'grid', 'panZoom'].map((k) => ['invalid ' + k, { ...valid, [k]: 'true' }]),
  ['pan incomplete', { ...valid, pan: { x: 1 } }],
  ['pan wrong type', { ...valid, pan: { x: '1', y: 2 } }],
  ['zoom wrong type', { ...valid, zoom: '1' }]
])
  add(name, value, false);
const previousContract = await readJson(path.join(prior.run, 'contract.json'));
const contract = {
  version: 1,
  source: { module: entry, export: 'isValidSharedState' },
  target: { module: targetEntry, export: 'isValidSharedState' },
  runtime: { aliases: true, transformTypes: true },
  cases,
  regression: previousContract.regression,
  checks: previousContract.checks
};
await saveJson(path.join(root, 'contract.json'), contract);
await saveJson(path.join(root, 'model.json'), {
  ...(await readJson(prior.config)),
  contextFiles: [targetEntry, consumer, 'src/lib/types.d.ts'],
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
  consumer,
  contract: path.join(root, 'contract.json'),
  config: path.join(root, 'model.json'),
  mount: 'src/lib/features/zod-state',
  originalSource: original,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: original, encoding: 'utf8' }).trim(),
  projected,
  omitted,
  sourceFiles: analysis.files.length,
  notes: [
    'Six-package Zod workspace copied; symlinked documentation files explicitly omitted. Original Git checkout unchanged.',
    'Source JSON schema boundary and target validation boundary authored before freeze. Original serde consumer calls the baseline helper before adaptation.',
    'Source Zod implementation unchanged. Destination uses its original SvelteKit 2 alias config without a custom map.'
  ]
};
await saveJson(path.join(root, 'setup.json'), record);
await saveJson(path.join(base, 'setup-latest.json'), record);
console.log(root, analysis.files.length, cases.length, omitted);
