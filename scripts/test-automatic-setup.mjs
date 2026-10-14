import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { executeCommand } from '../src/index.mjs';
import { saveJson, inventory, readJson, same } from '../src/platform/files.mjs';
import { runProcess } from '../src/platform/process.mjs';
const base = path.resolve('.portsmith/package-bench');
await fs.mkdir(base, { recursive: true });
const root = await fs.mkdtemp(path.join(base, 'workspace-installs-'));
const results = [];
for (const manager of ['npm', 'pnpm']) {
  const dir = path.join(root, manager);
  await fs.mkdir(dir);
  const source = path.join(dir, 'source'),
    donor = path.join(dir, 'donor');
  await fs.mkdir(path.join(source, 'packages/app'), { recursive: true });
  await fs.mkdir(donor);
  await saveJson(path.join(source, 'package.json'), {
    private: true,
    type: 'module',
    packageManager: manager + '@' + (manager === 'npm' ? '11.6.2' : '10.34.6'),
    ...(manager === 'npm' ? { workspaces: ['packages/*'] } : {})
  });
  if (manager === 'pnpm')
    await fs.writeFile(path.join(source, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  await saveJson(path.join(source, 'packages/app/package.json'), {
    name: 'setup-workspace-test',
    private: true,
    type: 'module',
    version: '1.0.0',
    scripts: { postinstall: "node -e \"require('fs').writeFileSync('CANARY','ran')\"" }
  });
  await saveJson(path.join(donor, 'package.json'), { dependencies: { json5: '2.2.3' } });
  const proposal = path.join(dir, 'proposal.json');
  await saveJson(proposal, {
    edits: [
      {
        path: 'packages/app/src/feature.mjs',
        beforeSha256: null,
        content: "import JSON5 from 'json5'; export const parse = JSON5.parse;"
      }
    ]
  });
  const cache = path.join(dir, 'cache');
  await fs.mkdir(cache);
  const before = await inventory(source);
  const r = await executeCommand(
    'setup-deps',
    {
      source,
      out: path.join(dir, 'ready'),
      proposal,
      dependencySource: donor,
      cache,
      managerBin: path.resolve(
        '.portsmith/dependency-bench/tools/node_modules',
        manager,
        manager === 'npm' ? 'bin/npm-cli.js' : 'bin/pnpm.cjs'
      ),
      allowExecution: true
    },
    { allowExecution: true }
  );
  const offline = await executeCommand(
    'setup-deps',
    {
      source,
      out: path.join(dir, 'offline'),
      proposal,
      dependencySource: donor,
      cache,
      offline: true,
      managerBin: path.resolve(
        '.portsmith/dependency-bench/tools/node_modules',
        manager,
        manager === 'npm' ? 'bin/npm-cli.js' : 'bin/pnpm.cjs'
      ),
      allowExecution: true
    },
    { allowExecution: true }
  );
  assert.equal(offline.status, 'ready');
  assert(same(before, await inventory(source)));
  await assert.rejects(fs.stat(path.join(r.source, 'packages/app/CANARY')));
  await assert.rejects(fs.stat(path.join(r.source, 'packages/app/src/feature.mjs')));
  const test = await runProcess(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import JSON5 from 'json5';import assert from 'node:assert/strict';assert.deepEqual(JSON5.parse('{a:1,}'),{a:1});console.log('passed')"
    ],
    { cwd: path.join(r.source, 'packages/app') }
  );
  assert.equal(test.exitCode, 0, test.stderr);
  const again = await executeCommand(
    'setup-deps',
    { source: r.source, out: path.join(dir, 'again'), allowExecution: true },
    { allowExecution: true }
  ).then(
    () => false,
    (e) => /uncaptured repository/.test(e.message)
  );
  assert(again);
  results.push({
    manager,
    receipt: r.receipt,
    result: 'passed',
    offline: 'passed',
    offlineReceipt: offline.receipt,
    scriptsExecuted: false,
    originalUnchanged: true,
    ownerManifest: 'packages/app/package.json',
    executions: (await readJson(r.receipt)).executions
  });
  console.log(manager, 'PASSED');
}
await saveJson(path.join(base, 'workspace-installs-latest.json'), { root, results });
