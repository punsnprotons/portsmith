import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { executeCommand, analyze } from '../src/index.mjs';
import { readJson, saveJson, inventory, copyInventory } from '../src/platform/files.mjs';
const base = path.resolve('.portsmith/package-bench');
await fs.mkdir(base, { recursive: true });
const root = await fs.mkdtemp(path.join(base, 'setup-'));
const previous = await readJson('.portsmith/virtual-bench/setup-latest.json');
const target = path.join(root, 'target');
await copyInventory(
  path.join(previous.root, 'target'),
  target,
  await inventory(path.join(previous.root, 'target'))
);
const manifest = await readJson(path.join(target, 'package.json'));
delete manifest.dependencies.yaml;
await saveJson(path.join(target, 'package.json'), manifest);
// Preserve the upstream lock as the resolver's starting point; additions happen only in setup-deps' fresh output.
await fs.copyFile(
  '.portsmith/complex-bench/repos/drawdb/package-lock.json',
  path.join(target, 'package-lock.json')
);
const donor = path.join(root, 'catalog');
await fs.mkdir(donor);
await saveJson(path.join(donor, 'package.json'), {
  private: true,
  dependencies: { yaml: '2.8.1', json5: '2.2.3' }
});
const proposal = path.join(root, 'import-proposal.json');
await saveJson(proposal, {
  edits: [
    {
      path: previous.targetEntry,
      beforeSha256: (await inventory(target))[previous.targetEntry].sha256,
      content:
        "import {parseAllDocuments} from 'yaml'; import JSON5 from 'json5';\nexport function stateHistory(documents,format='yaml'){throw Error('integration pending')}\nexport function statesEqual(a,b){return false;}\n"
    }
  ]
});
const prepared = await executeCommand(
  'setup-deps',
  {
    source: target,
    out: path.join(root, 'ready-target'),
    proposal,
    dependencySource: donor,
    capture: true,
    managerBin: path.resolve('.portsmith/dependency-bench/tools/node_modules/npm/bin/npm-cli.js'),
    allowExecution: true,
    timeoutMs: 120000
  },
  { allowExecution: true }
);
await saveJson(path.join(root, 'setup-result.json'), prepared);
console.log('SETUP', JSON.stringify(prepared));
const contract = await readJson(previous.contract);
const jsonCases = contract.cases.map((item, i) => ({
  ...item,
  name: item.name + ' json5',
  targetArgs: [JSON.stringify(item.sourceArgs[0]), 'json5']
}));
contract.cases.push(...jsonCases);
await saveJson(path.join(root, 'contract.json'), contract);
const setup = {
  ...previous,
  root,
  source: previous.source,
  target: prepared.source,
  contract: path.join(root, 'contract.json'),
  config: previous.config,
  dependencySetup: prepared.receipt
};
setup.graph = await analyze({
  source: setup.source,
  target: setup.target,
  entry: setup.entry,
  aliases: true
});
assert.equal(setup.graph.blockers.length, 0, JSON.stringify(setup.graph.blockers));
await saveJson(path.join(base, 'setup-latest.json'), setup);
console.log('READY', root, contract.cases.length);
