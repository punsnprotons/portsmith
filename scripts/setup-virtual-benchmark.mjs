// Fresh authored boundaries around unchanged pinned jsondiffpatch and drawDB code.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { inventory, copyInventory, saveJson, readJson } from '../src/platform/files.mjs';
import { executeCommand, analyze } from '../src/index.mjs';
const base = path.resolve('.portsmith/virtual-bench');
await fs.mkdir(base, { recursive: true });
const root = await fs.mkdtemp(path.join(base, 'setup-'));
const prior = await readJson('.portsmith/dynamic-bench/setup-latest.json');
const source = path.join(root, 'source'),
  target = path.join(root, 'target');
for (const [from, to] of [
  [path.join(prior.root, 'source'), source],
  [path.join(prior.root, 'target'), target]
]) {
  await copyInventory(from, to, await inventory(from));
  execFileSync('cp', ['-cR', path.join(from, 'node_modules'), path.join(to, 'node_modules')]);
}
// Real upstream diff engine; generated policy modules are authored for this stress test.
const sourceConfig = path.join(source, 'vite.config.mjs');
const plugin = `{name:'virtual-history-policy',resolveId(id){if(id.startsWith('virtual:history-'))return '\\0'+id;},load(id){if(id==='\\0virtual:history-policy')return "import {identity} from 'virtual:history-identity';export const options={objectHash:identity};";if(id==='\\0virtual:history-identity')return "export function identity(o){return o.id!==undefined?String(o.id):JSON.stringify(o)}";}}`;
await fs.writeFile(
  sourceConfig,
  (await fs.readFile(sourceConfig, 'utf8')).replace('plugins:[paths(', `plugins:[${plugin},paths(`)
);
const entry = path.join(source, prior.entry);
await fs.writeFile(
  entry,
  (await fs.readFile(entry, 'utf8')).replace(
    'const engine=create({objectHash:o=>o.id!==undefined?String(o.id):JSON.stringify(o)});',
    "import {options} from 'virtual:history-policy';\nconst engine=create(options);"
  )
);
// yaml is a newly provisioned destination dependency. No frozen run or old lockfile is edited.
const pkg = await readJson(path.join(target, 'package.json'));
pkg.dependencies = { ...pkg.dependencies, yaml: '2.8.1' };
await saveJson(path.join(target, 'package.json'), pkg);
// The old lock no longer describes this authored setup: this benchmark uses reviewed dependency copies.
await fs.rm(path.join(target, 'package-lock.json'), { force: true });
await fs.rm(path.join(target, 'node_modules/yaml'), { recursive: true, force: true });
execFileSync('cp', ['-cR', path.resolve('node_modules/yaml'), path.join(target, 'node_modules/yaml')]);
await fs.writeFile(
  path.join(target, prior.targetEntry),
  `// Destination's public API accepts YAML snapshot documents; baseline has no history implementation.\nexport function stateHistory(documents){return {latest:null,restored:null,changed:[]};}\nexport function statesEqual(a,b){return JSON.stringify(a)===JSON.stringify(b);}\n`
);
const imports = path.join(root, 'planned-imports.json');
await saveJson(imports, [{ importer: prior.targetEntry, specifier: 'yaml' }]);
const capturedSource = path.join(root, 'captured-source'),
  capturedTarget = path.join(root, 'captured-target');
for (const [s, out, extra] of [
  [source, capturedSource, { virtualModules: true }],
  [target, capturedTarget, { imports }]
]) {
  const result = await executeCommand(
    'capture-aliases',
    { source: s, out, ...extra, allowExecution: true },
    { allowExecution: true }
  );
  console.log('CAPTURE', JSON.stringify(result));
}
const contract = await readJson(prior.contract);
contract.runtime = { aliases: true, capturedImports: true };
for (const item of contract.cases)
  item.targetArgs = [item.sourceArgs[0].map((state) => YAML.stringify(state)).join('---\n')];
await saveJson(path.join(root, 'contract.json'), contract);
const model = await readJson(prior.config);
await saveJson(path.join(root, 'model.json'), model);
const graph = await analyze({
  source: capturedSource,
  target: capturedTarget,
  entry: prior.entry,
  aliases: true
});
if (graph.blockers.length) throw Error(JSON.stringify(graph.blockers));
const setup = {
  ...prior,
  root,
  source: capturedSource,
  target: capturedTarget,
  contract: path.join(root, 'contract.json'),
  config: path.join(root, 'model.json'),
  graph
};
await saveJson(path.join(base, 'setup-latest.json'), setup);
console.log('SETUP', root, 'FILES', graph.files.length);
