import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';
import { prepare, adapt, verify, exportPatch, executeCommand } from '../src/index.mjs';
import { saveJson, readJson, inventory, same, hash } from '../src/platform/files.mjs';
import { runProcess } from '../src/platform/process.mjs';
const base = path.resolve('.portsmith/workspace-bench'),
  root = await fs.mkdtemp(path.join(base, 'live-install-')),
  results = [];
for (const manager of ['npm', 'pnpm']) {
  const folder = path.join(root, manager);
  await fs.mkdir(folder);
  const input = await fixture(folder),
    version = manager === 'npm' ? '11.6.2' : '10.34.6';
  const command = path.resolve(
    '.portsmith/dependency-bench/tools/node_modules',
    manager,
    'bin',
    manager === 'npm' ? 'npm-cli.js' : 'pnpm.cjs'
  );
  await saveJson(path.join(input.target, 'package.json'), {
    private: true,
    type: 'module',
    packageManager: manager + '@' + version,
    ...(manager === 'npm' ? { workspaces: ['packages/*'] } : {})
  });
  if (manager === 'pnpm')
    await fs.writeFile(path.join(input.target, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  for (const name of ['a', 'b']) {
    const dir = path.join(input.target, 'packages', name);
    await fs.mkdir(dir, { recursive: true });
    await saveJson(path.join(dir, 'package.json'), {
      name: '@test/' + name,
      version: '1.0.0',
      type: 'module',
      exports: './index.mjs',
      ...(name === 'a'
        ? { dependencies: { '@test/b': manager === 'pnpm' ? 'workspace:*' : '*', 'is-number': '7.0.0' } }
        : {}),
      scripts: { postinstall: 'node -e "throw Error(\'lifecycle ran\')"' }
    });
    await fs.writeFile(
      path.join(dir, 'index.mjs'),
      name === 'a'
        ? "import {identity} from '@test/b';import isNumber from 'is-number';export const check=x=>isNumber(x)?identity(Number(x)):null;"
        : 'export const identity=x=>x;'
    );
  }
  const lock = await runProcess(
    command,
    manager === 'npm'
      ? [
          'install',
          '--package-lock-only',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--cache',
          path.join(base, 'cache')
        ]
      : ['install', '--lockfile-only', '--ignore-scripts', '--store-dir', path.join(base, 'store')],
    { cwd: input.target, timeoutMs: 120000 }
  );
  assert.equal(lock.exitCode, 0, lock.stderr);
  await fs.writeFile(
    path.join(input.target, 'test/workspace.test.mjs'),
    "import {test} from 'node:test';import assert from 'node:assert/strict';import {check} from '../packages/a/index.mjs';test('internal workspace and registry imports',()=>{assert.equal(check('42'),42);assert.equal(check('abc'),null)});"
  );
  const contract = await readJson(input.contract);
  contract.regression.args.push('test/workspace.test.mjs');
  await saveJson(input.contract, contract);
  const before = await inventory(input.target);
  await prepare(input);
  const plan = await executeCommand('dependencies', { run: input.out });
  assert.equal(plan.status, 'ready', JSON.stringify(plan));
  assert.equal(plan.sides[1].workspace.members.length, 2);
  const installed = await executeCommand(
    'install-deps',
    { run: input.out, allowExecution: true, managerBin: command },
    { allowExecution: true }
  );
  await adapt(input.out, path.join(folder, 'proposal.json'));
  const v = await verify(input.out, { allowExecution: true });
  assert.equal(v.status, 'verified-for-contract', JSON.stringify(v));
  await exportPatch(input.out);
  assert(same(before, await inventory(input.target)));
  results.push({
    manager,
    run: input.out,
    status: 'passed',
    directories: installed.sides.map((s) => ({ side: s.side, directories: s.directories })),
    lockOutputSha256: hash(lock.stdout + lock.stderr),
    regressions: v.regression
  });
  await saveJson(path.join(root, 'results.json'), results);
  console.log(manager, 'workspace passed');
}
await saveJson(path.join(base, 'live-install-latest.json'), { root, results });
