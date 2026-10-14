import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fixture } from '../scripts/fixture.mjs';
import { executeCommand, prepare, adapt, verify, exportPatch, commandResult, status } from '../src/index.mjs';
import { saveJson, readJson } from '../src/platform/files.mjs';
async function setup(t, kind = 'npm') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-deps-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = await fixture(root);
  await saveJson(path.join(input.target, 'package.json'), {
    type: 'module',
    dependencies: { example: '1.0.0' },
    scripts: { postinstall: 'must never run' },
    ...(kind === 'pnpm' ? { packageManager: 'pnpm@10.0.0' } : {})
  });
  await fs.writeFile(
    path.join(input.target, kind === 'pnpm' ? 'pnpm-lock.yaml' : 'package-lock.json'),
    kind === 'pnpm' ? 'lockfileVersion: 9.0\n' : JSON.stringify({ lockfileVersion: 3 })
  );
  await prepare(input);
  const shim = path.join(root, 'manager');
  await fs.writeFile(
    shim,
    `#!${process.execPath}\nimport fs from 'node:fs';\nif(process.argv[2]==='--version'){console.log('10.0.0');}else{if(!process.argv.includes('--ignore-scripts'))throw Error('unsafe');if(process.env.OPENAI_API_KEY)throw Error('inherited key');fs.mkdirSync('node_modules');fs.writeFileSync('node_modules/receipt.txt',JSON.stringify(process.argv));}\n`,
    { mode: 0o700 }
  );
  // The shim is an explicit protocol double, never counted as a real package installation.
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  return { root, input, shim };
}
test('dependency plan is read-only and requires exact supported lockfile selection', async (t) => {
  const { input } = await setup(t);
  const p = await executeCommand('dependencies', { run: input.out });
  assert.equal(p.status, 'ready');
  assert.equal(p.sides[0].status, 'not-needed');
  assert.equal(p.sides[1].manager, 'npm');
  await assert.rejects(fs.stat(path.join(input.out, 'baseline/node_modules')));
  const denied = await commandResult('install-deps', { run: input.out });
  assert.equal(denied.error.code, 'execution_not_authorized');
});
for (const kind of ['npm', 'pnpm'])
  test(
    kind +
      ' installer protocol disables scripts, isolates snapshots, retains receipt and invalidates verification',
    async (t) => {
      const { root, input, shim } = await setup(t, kind);
      await adapt(input.out, path.join(root, 'proposal.json'));
      assert.equal((await verify(input.out, { allowExecution: true })).status, 'verified-for-contract');
      const r = await executeCommand(
        'install-deps',
        { run: input.out, managerBin: shim, allowExecution: true, offline: true },
        { allowExecution: true }
      );
      assert.equal(r.status, 'installed');
      const args = JSON.parse(await fs.readFile(path.join(input.out, 'candidate/node_modules/receipt.txt')));
      assert(args.includes('--offline'));
      assert(args.includes(kind === 'npm' ? 'ci' : '--frozen-lockfile'));
      assert(args.includes('--ignore-scripts'));
      assert(args.some((x) => x.startsWith(kind === 'pnpm' ? '--config.userconfig=' : '--userconfig=')));
      assert(args.some((x) => x.startsWith(kind === 'pnpm' ? '--config.globalconfig=' : '--globalconfig=')));
      await assert.rejects(fs.stat(path.join(input.target, 'node_modules')));
      await assert.rejects(exportPatch(input.out), /Dependency setup changed/);
      assert.equal((await status(input.out)).verification.stale, true);
      assert.equal((await verify(input.out, { allowExecution: true })).status, 'verified-for-contract');
      await exportPatch(input.out);
      await fs.rm(path.join(input.out, 'candidate/node_modules'), { recursive: true });
      await assert.rejects(exportPatch(input.out));
    }
  );
test('failed installs preserve previous dependencies and cannot retain a verified result', async (t) => {
  const { root, input, shim } = await setup(t);
  await adapt(input.out, path.join(root, 'proposal.json'));
  await verify(input.out, { allowExecution: true });
  await fs.mkdir(path.join(input.out, 'baseline/node_modules'));
  await fs.writeFile(path.join(input.out, 'baseline/node_modules/keep'), 'keep');
  await fs.writeFile(
    shim,
    `#!${process.execPath}\nconsole.log(process.argv[2]==='--version'?'10.0.0':'SECRET_REGISTRY_RESPONSE');process.exit(process.argv[2]==='--version'?0:1);\n`,
    { mode: 0o700 }
  );
  await assert.rejects(
    executeCommand(
      'install-deps',
      { run: input.out, managerBin: shim, allowExecution: true },
      { allowExecution: true }
    ),
    /Locked install failed/
  );
  assert.equal(await fs.readFile(path.join(input.out, 'baseline/node_modules/keep'), 'utf8'), 'keep');
  const text = await fs.readFile(path.join(input.out, 'dependencies.json'), 'utf8');
  assert(!text.includes('SECRET_REGISTRY_RESPONSE'));
  assert.equal(JSON.parse(text).status, 'failed');
  assert.equal((await status(input.out)).verification.stale, true);
  await assert.rejects(verify(input.out, { allowExecution: true }), /incomplete/);
});
test('installer rejects a changed lockfile and does not publish staged dependencies', async (t) => {
  const { input, shim } = await setup(t);
  await fs.writeFile(
    shim,
    `#!${process.execPath}\nimport fs from 'node:fs';if(process.argv[2]==='--version') console.log('10.0.0');else{fs.writeFileSync('package-lock.json','changed');fs.mkdirSync('node_modules');}\n`,
    { mode: 0o700 }
  );
  await assert.rejects(
    executeCommand(
      'install-deps',
      { run: input.out, managerBin: shim, allowExecution: true },
      { allowExecution: true }
    ),
    /changed the manifest or lockfile/
  );
  await assert.rejects(fs.stat(path.join(input.out, 'baseline/node_modules')));
});
test('package-manager version mismatch and timeouts fail closed', async (t) => {
  const { input, shim } = await setup(t, 'pnpm');
  await fs.writeFile(shim, `#!${process.execPath}\nconsole.log('9.0.0');\n`, { mode: 0o700 });
  await assert.rejects(
    executeCommand(
      'install-deps',
      { run: input.out, managerBin: shim, allowExecution: true },
      { allowExecution: true }
    ),
    /version differs/
  );
  await fs.writeFile(
    shim,
    `#!${process.execPath}\nif(process.argv[2]==='--version')console.log('10.0.0');else setTimeout(()=>{},10000);\n`,
    { mode: 0o700 }
  );
  await assert.rejects(
    executeCommand(
      'install-deps',
      { run: input.out, managerBin: shim, allowExecution: true, timeoutMs: 100 },
      { allowExecution: true }
    ),
    /timeout/
  );
  assert.equal((await readJson(path.join(input.out, 'dependencies.json'))).sides[1].diagnostic, 'timeout');
  await assert.rejects(fs.stat(path.join(input.out, 'baseline/node_modules')));
});
test('unsupported workspace and transitive local lockfile resolutions are preview blockers', async (t) => {
  for (const variant of ['workspace', 'linked', 'git', 'registry']) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-plan-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const input = await fixture(root);
    await saveJson(path.join(input.target, 'package.json'), {
      type: 'module',
      dependencies: { example: '1.0.0' },
      ...(variant === 'workspace' ? { workspaces: ['packages/*'] } : {})
    });
    await saveJson(path.join(input.target, 'package-lock.json'), {
      lockfileVersion: 3,
      packages: {
        'node_modules/example':
          variant === 'linked'
            ? { link: true }
            : {
                resolved:
                  variant === 'git'
                    ? 'git+ssh://host/repo'
                    : variant === 'registry'
                      ? 'https://private.example/pkg.tgz'
                      : 'https://registry.npmjs.org/example/-/example-1.0.0.tgz'
              }
      }
    });
    await prepare(input);
    assert.equal((await executeCommand('dependencies', { run: input.out })).status, 'blocked');
    await assert.rejects(fs.stat(path.join(input.out, 'dependencies.json')));
  }
});
