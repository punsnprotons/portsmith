// Reviewed upstream implementations; authored integration boundaries/configurations freeze before model trials.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inventory, copyInventory, saveJson, readJson, hash } from '../src/platform/files.mjs';
import { executeCommand, analyze } from '../src/index.mjs';
const base = path.resolve('.portsmith/dynamic-bench'),
  root = await fs.mkdtemp(path.join(base, 'setup-'));
const original = path.join(base, 'jsondiffpatch'),
  source = path.join(root, 'source'),
  target = path.join(root, 'target');
await copyInventory(original, source, await inventory(original));
const prior = await readJson('.portsmith/complex-bench/drawdb-latest.json');
await copyInventory(
  path.join(prior.run, 'baseline'),
  target,
  await inventory(path.join(prior.run, 'baseline'))
);
const cp = (a, b) =>
  fs.cp(a, b, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
await cp(path.join(base, 'tools/node_modules'), path.join(source, 'node_modules'));
await cp(path.join(prior.run, 'baseline/node_modules'), path.join(target, 'node_modules'));
await cp(path.join(base, 'tools/node_modules/@dmsnell'), path.join(target, 'node_modules/@dmsnell'));
for (const dir of [source, target]) {
  const pkg = await readJson(path.join(dir, 'package.json'));
  pkg.dependencies = { ...pkg.dependencies, '@dmsnell/diff-match-patch': '^1.1.0' };
  await saveJson(path.join(dir, 'package.json'), pkg);
}
// Avoid the monorepo's root config scope; the actual plugin searches the authored mapping explicitly.
await saveJson(path.join(source, 'portsmith.paths.json'), {
  compilerOptions: {
    allowJs: true,
    baseUrl: '.',
    paths: { '@delta': ['packages/jsondiffpatch/src/index.ts'] }
  },
  include: ['portsmith-delta.mjs']
});
await fs.writeFile(
  path.join(source, 'vite.config.mjs'),
  "import paths from 'vite-tsconfig-paths';export default async ({mode})=>({plugins:[paths({projects:['portsmith.paths.json'],loose:true})],build:{lib:{entry:'portsmith-delta.mjs',formats:['es']}}});"
);
const entry = 'portsmith-delta.mjs',
  targetEntry = 'src/utils/deltaHistory.js';
const bridge = `// Authored JSON boundary around the unchanged upstream diff, patch and reverse engine.\nimport {create} from '@delta';
const engine=create({objectHash:o=>o.id!==undefined?String(o.id):JSON.stringify(o)});
export function stateHistory(states){
 const copies=structuredClone(states),deltas=[];let current=structuredClone(copies[0]);
 for(let i=1;i<copies.length;i++){const delta=engine.diff(copies[i-1],copies[i]);deltas.push(delta??null);if(delta)current=engine.patch(current,structuredClone(delta));}
 const latest=structuredClone(current);
 for(let i=deltas.length-1;i>=0;i--)if(deltas[i])current=engine.unpatch(current,structuredClone(deltas[i]));
 return {latest,restored:current,changed:deltas.map(d=>d!==null)};
}
export function statesEqual(a,b){return engine.diff(a,b)===undefined;}\n`;
await fs.writeFile(path.join(source, entry), bridge);
await fs.writeFile(
  path.join(target, targetEntry),
  `// Baseline retains only the initial snapshot; adaptation must connect the transferred engine.\nexport function stateHistory(states){return {latest:structuredClone(states[0]),restored:structuredClone(states[0]),changed:states.slice(1).map(()=>false)};}\nexport function statesEqual(a,b){return JSON.stringify(a)===JSON.stringify(b);}\n`
);
const utils = path.join(target, 'src/utils/utils.js');
await fs.writeFile(
  utils,
  "import {statesEqual} from '@history';\n" +
    (await fs.readFile(utils, 'utf8')).replace(
      'return JSON.stringify(arr1) === JSON.stringify(arr2);',
      'return statesEqual(arr1, arr2);'
    )
);
await fs.writeFile(
  path.join(target, 'vite.config.js'),
  `import path from 'node:path';import react from '@vitejs/plugin-react';
export default async({command,mode})=>({plugins:[react(),{name:'authored-history-resolution',resolveId(id,from){if(id==='@history'&&from?.endsWith('/src/utils/utils.js')&&command==='build'&&mode==='production')return path.resolve('src/utils/deltaHistory.js');}}]});\n`
);
const capturedSource = path.join(root, 'captured-source'),
  capturedTarget = path.join(root, 'captured-target');
for (const [s, o] of [
  [source, capturedSource],
  [target, capturedTarget]
])
  console.log(
    await executeCommand(
      'capture-aliases',
      { source: s, out: o, allowExecution: true },
      { allowExecution: true }
    )
  );
const series = [
  [{}, {}],
  [{ a: 1 }, { a: 2 }, { b: 3 }],
  [
    [
      { id: 1, n: 'a' },
      { id: 2, n: 'b' }
    ],
    [
      { id: 2, n: 'B' },
      { id: 1, n: 'a' }
    ],
    [
      { id: 3, n: 'c' },
      { id: 2, n: 'B' }
    ]
  ],
  [{ a: { b: [1, 2, 3] } }, { a: { b: [3, 1] } }, { a: null }],
  [{ text: 'a'.repeat(200) }, { text: 'b'.repeat(300) }],
  [null, { x: true }, [false, 0, '', null]],
  [
    { a: 1, b: 2 },
    { b: 2, a: 1 }
  ],
  [{ unicode: '日本語 👋' }, { unicode: 'தமிழ்' }],
  [[1, 1, 2], [1, 2, 1], []]
];
const cases = series.map((states, i) => ({
  name: 'delta history ' + i,
  sourceArgs: [states],
  targetArgs: [states],
  expected: {
    latest: states.at(-1),
    restored: states[0],
    changed: states.slice(1).map((x, j) => JSON.stringify(x) !== JSON.stringify(states[j]) && i !== 6)
  }
}));
// Independent expected changed values include semantic property order equality.
const contract = {
  version: 1,
  source: { module: entry, export: 'stateHistory' },
  target: { module: targetEntry, export: 'stateHistory' },
  runtime: { aliases: true },
  cases,
  regression: (await readJson(path.join(prior.run, 'contract.json'))).regression,
  checks: (await readJson(path.join(prior.run, 'contract.json'))).checks
};
await saveJson(path.join(root, 'contract.json'), contract);
const config = {
  ...(await readJson('.portsmith/index-bench/setup-ICpy1s/model.json')),
  contextFiles: [targetEntry, 'src/utils/utils.js'],
  maxContextBytes: 1000000
};
await saveJson(path.join(root, 'model.json'), config);
const graph = await analyze({
  source: capturedSource,
  target: capturedTarget,
  entry,
  aliases: true,
  runtimeOnly: true
});
console.log('GRAPH', graph.files.length, graph.blockers);
const setup = {
  root,
  source: capturedSource,
  target: capturedTarget,
  entry,
  targetEntry,
  mount: 'src/features/jsondiffpatch',
  contract: path.join(root, 'contract.json'),
  config: path.join(root, 'model.json'),
  original,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: original, encoding: 'utf8' }).trim(),
  originalSourceInventory: await inventory(original),
  targetBase: path.join(prior.run, 'baseline'),
  graph
};
await saveJson(path.join(base, 'setup-latest.json'), setup);
console.log('SETUP', root);
