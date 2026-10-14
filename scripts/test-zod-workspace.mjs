import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';
import { prepare, adapt, verify, exportPatch, executeCommand } from '../src/index.mjs';
import { readJson, saveJson, inventory, copyInventory } from '../src/platform/files.mjs';
const base = path.resolve('.portsmith/workspace-bench'),
  setup = await readJson(path.join(base, 'setup-latest.json')),
  root = await fs.mkdtemp(path.join(base, 'zod-install-')),
  input = await fixture(root);
const target = path.join(root, 'workspace');
await copyInventory(setup.source, target, await inventory(setup.source));
await copyInventory(
  path.join(input.target, 'src'),
  path.join(target, 'src'),
  await inventory(path.join(input.target, 'src'))
);
await copyInventory(
  path.join(input.target, 'test'),
  path.join(target, 'test'),
  await inventory(path.join(input.target, 'test'))
);
await fs.mkdir(path.join(target, 'packages/bench/test'), { recursive: true });
await fs.writeFile(
  path.join(target, 'packages/bench/test/portsmith-probe.mjs'),
  "import assert from 'node:assert/strict';import {z} from 'zod/v4';assert.equal(z.object({name:z.string()}).safeParse({name:'linked'}).success,true);assert.equal(z.object({name:z.string()}).safeParse({name:42}).success,false);console.log('Real linked Zod source import passed');"
);
const contract = await readJson(input.contract);
contract.checks = [
  {
    name: 'Real internal workspace source export',
    command: process.execPath,
    args: [
      '--experimental-transform-types',
      '--conditions=@zod/source',
      '--import',
      path.resolve('src/providers/node/register-aliases.mjs'),
      'packages/bench/test/portsmith-probe.mjs'
    ]
  }
];
await saveJson(input.contract, contract);
input.target = target;
await prepare(input);
const plan = await executeCommand('dependencies', { run: input.out });
await saveJson(path.join(root, 'plan.json'), plan);
assert.equal(plan.status, 'ready', JSON.stringify(plan));
console.log('planned', plan.sides[1].workspace.members.length, 'packages');
await executeCommand(
  'install-deps',
  {
    run: input.out,
    allowExecution: true,
    managerBin: path.join(base, 'tools/node_modules/pnpm/bin/pnpm.cjs')
  },
  { allowExecution: true }
);
console.log('installed');
await adapt(input.out, path.join(root, 'proposal.json'));
const report = await verify(input.out, { allowExecution: true, timeoutMs: 120000 });
await saveJson(path.join(root, 'result.json'), report);
assert.equal(report.status, 'verified-for-contract', JSON.stringify(report));
await exportPatch(input.out);
await saveJson(path.join(base, 'zod-install-latest.json'), {
  root,
  run: input.out,
  status: report.status,
  workspacePackages: plan.sides[1].workspace.members
});
console.log('Zod workspace passed');
