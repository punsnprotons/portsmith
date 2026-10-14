// Real public-registry checks, separate from installer protocol doubles.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';
import { prepare, executeCommand, adapt, verify, exportPatch } from '../src/index.mjs';
import { saveJson, hash } from '../src/platform/files.mjs';
import { runProcess } from '../src/platform/process.mjs';
const base = path.resolve('.portsmith/dependency-bench'),
  root = await fs.mkdtemp(path.join(base, 'live-')),
  results = [];
for (const manager of ['npm', 'pnpm']) {
  const folder = path.join(root, manager);
  await fs.mkdir(folder);
  const input = await fixture(folder);
  const command = path.join(
    base,
    'tools/node_modules',
    manager,
    'bin',
    manager === 'npm' ? 'npm-cli.js' : 'pnpm.cjs'
  );
  await saveJson(path.join(input.target, 'package.json'), {
    private: true,
    type: 'module',
    packageManager: manager + '@' + (manager === 'npm' ? '11.6.2' : '10.34.6'),
    dependencies: { 'is-number': '7.0.0' },
    scripts: { postinstall: `node -e "require('fs').writeFileSync('node_modules/POSTINSTALL_RAN','unsafe')"` }
  });
  const args =
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
      : ['install', '--lockfile-only', '--ignore-scripts', '--store-dir', path.join(base, 'store')];
  args.push('--registry=https://registry.npmjs.org');
  const lock = await runProcess(command, args, { cwd: input.target, timeoutMs: 120000 });
  assert.equal(lock.exitCode, 0, lock.stderr);
  await prepare(input);
  const installed = await executeCommand(
    'install-deps',
    { run: input.out, allowExecution: true, managerBin: command },
    { allowExecution: true }
  );
  for (const side of ['baseline', 'candidate']) {
    const cwd = path.join(input.out, side);
    await assert.rejects(fs.stat(path.join(cwd, 'node_modules/POSTINSTALL_RAN')));
    const loaded = await runProcess(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import isNumber from 'is-number';if(!isNumber('42')||isNumber('abc'))throw Error('load failed');"
      ],
      { cwd }
    );
    assert.equal(loaded.exitCode, 0, loaded.stderr);
  }
  await adapt(input.out, path.join(folder, 'proposal.json'));
  assert.equal((await verify(input.out, { allowExecution: true })).status, 'verified-for-contract');
  await exportPatch(input.out);
  results.push({
    manager,
    run: input.out,
    status: 'passed',
    installed,
    lockGeneration: { exitCode: lock.exitCode, outputSha256: hash(lock.stdout + lock.stderr) }
  });
  await saveJson(path.join(root, 'results.json'), results);
  console.log(manager, 'passed');
}
await saveJson(path.join(base, 'live-latest.json'), { root, results });
