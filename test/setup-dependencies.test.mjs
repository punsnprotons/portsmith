import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { executeCommand, commandResult } from '../src/index.mjs';
import { saveJson, inventory, readJson } from '../src/platform/files.mjs';
async function fixture(t, manager = 'npm') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-preflight-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'),
    donor = path.join(root, 'donor'),
    out = path.join(root, 'ready'),
    proposal = path.join(root, 'proposal.json');
  await fs.mkdir(source);
  await fs.mkdir(donor);
  await saveJson(path.join(source, 'package.json'), {
    type: 'module',
    private: true,
    packageManager: manager + '@10.0.0',
    scripts: { postinstall: 'NEVER_EXECUTE' }
  });
  await saveJson(path.join(donor, 'package.json'), {
    dependencies: { yaml: '2.8.1', '@scope/pkg': '^1.2.0' }
  });
  await saveJson(proposal, {
    edits: [
      {
        path: 'src/new.ts',
        beforeSha256: null,
        content:
          "import {parse} from 'yaml'; export {x} from '@scope/pkg/sub'; const x = import('yaml'); import fs from 'node:fs'; import other from './local.js';"
      }
    ]
  });
  const shim = path.join(root, 'manager.mjs');
  await fs.writeFile(
    shim,
    `#!${process.execPath}\nimport fs from 'node:fs';if(process.argv[2]==='--version'){console.log('10.0.0');}else{if(!process.argv.includes('--ignore-scripts')||process.env.OPENAI_API_KEY)process.exit(2);if(process.argv.includes('--package-lock-only'))fs.writeFileSync('package-lock.json',JSON.stringify({lockfileVersion:3,packages:{}}));else if(process.argv.includes('--lockfile-only'))fs.writeFileSync('pnpm-lock.yaml','lockfileVersion: 9.0\\n');else {fs.mkdirSync('node_modules');fs.writeFileSync('node_modules/protocol.json',JSON.stringify(process.argv));}}`,
    { mode: 0o700 }
  );
  return {
    root,
    source,
    donor,
    out,
    proposal,
    shim,
    input: { source, out, proposal, dependencySource: donor, managerBin: shim, allowExecution: true }
  };
}
test('discovery deduplicates literal imports/subpaths and never applies the proposal', async (t) => {
  const f = await fixture(t),
    before = await inventory(f.source);
  const r = await executeCommand(
    'discover-imports',
    f.input && { source: f.source, proposal: f.proposal, dependencySource: f.donor }
  );
  assert.equal(r.status, 'ready');
  assert.equal(r.records.length, 2);
  assert.deepEqual(
    r.additions.map((a) => a.name),
    ['yaml', '@scope/pkg']
  );
  assert.deepEqual(await inventory(f.source), before);
  await assert.rejects(fs.stat(path.join(f.source, 'src/new.ts')));
});
test('discovery blocks unknown aliases, computed imports, stale paths', async (t) => {
  const f = await fixture(t);
  for (const content of ["import x from 'unknown-alias'", 'import(name)', 'const = invalid']) {
    await saveJson(f.proposal, { edits: [{ path: 'x.mjs', beforeSha256: null, content }] });
    assert.equal(
      (
        await executeCommand('discover-imports', {
          source: f.source,
          proposal: f.proposal,
          dependencySource: f.donor
        })
      ).status,
      'blocked'
    );
  }
  await saveJson(f.proposal, { edits: [{ path: '../x.mjs', beforeSha256: null, content: '' }] });
  await assert.rejects(
    executeCommand('discover-imports', { source: f.source, proposal: f.proposal }),
    /Unsafe/
  );
  await saveJson(f.proposal, { edits: [{ path: 'x.mjs', beforeSha256: '0'.repeat(64), content: '' }] });
  await assert.rejects(
    executeCommand('discover-imports', { source: f.source, proposal: f.proposal }),
    /Stale/
  );
});
for (const manager of ['npm', 'pnpm'])
  test(
    manager +
      ' setup protocol generates then freezes locks, isolates scripts, preserves originals and leaves code unapplied',
    async (t) => {
      const f = await fixture(t, manager),
        before = await inventory(f.source);
      await fs.writeFile(path.join(f.source, '.env'), 'SECRET_DO_NOT_COPY');
      const r = await executeCommand('setup-deps', f.input, { allowExecution: true });
      assert.equal(r.status, 'ready');
      assert.equal(r.imports, 2);
      assert.deepEqual(await inventory(f.source), before);
      assert.equal((await readJson(path.join(f.out, 'package.json'))).dependencies.yaml, '2.8.1');
      await assert.rejects(fs.stat(path.join(f.out, 'src/new.ts')));
      await assert.rejects(fs.stat(path.join(f.out, '.env')));
      const receipt = await readJson(r.receipt);
      assert.deepEqual(
        receipt.executions.map((e) => e.phase),
        ['resolve', 'install']
      );
      assert.equal(receipt.behavior, 'not-verified');
      assert(receipt.changes.length === 2);
      const args = await readJson(path.join(f.out, 'node_modules/protocol.json'));
      assert(args.includes(manager === 'npm' ? 'ci' : '--frozen-lockfile'));
      await assert.rejects(executeCommand('setup-deps', f.input, { allowExecution: true }), /already exists/);
    }
  );
test('workspace import discovery assigns additions to the importing member', async (t) => {
  const f = await fixture(t);
  await saveJson(path.join(f.source, 'package.json'), { workspaces: ['packages/*'] });
  await fs.mkdir(path.join(f.source, 'packages/app'), { recursive: true });
  await saveJson(path.join(f.source, 'packages/app/package.json'), { name: 'app', version: '1.0.0' });
  await saveJson(f.proposal, {
    edits: [{ path: 'packages/app/src/new.ts', beforeSha256: null, content: "import x from 'yaml'" }]
  });
  const r = await executeCommand('discover-imports', {
    source: f.source,
    proposal: f.proposal,
    dependencySource: f.donor
  });
  assert.deepEqual(r.additions, [{ manifest: 'packages/app/package.json', name: 'yaml', range: '2.8.1' }]);
});
test('failed setup removes staging, never publishes output, redacts installer logs, requires authorization', async (t) => {
  const f = await fixture(t);
  assert.equal((await commandResult('setup-deps', f.input)).error.code, 'execution_not_authorized');
  await fs.writeFile(
    f.shim,
    `#!${process.execPath}\nconsole.log(process.argv[2]==='--version'?'10.0.0':'SECRET_DO_NOT_LEAK');process.exit(process.argv[2]==='--version'?0:1);`,
    { mode: 0o700 }
  );
  await assert.rejects(
    executeCommand('setup-deps', f.input, { allowExecution: true }),
    (e) => /setup_failed/.test(e.message) && !e.message.includes('SECRET')
  );
  await assert.rejects(fs.stat(f.out));
  assert(!(await fs.readdir(f.root)).some((x) => x.startsWith('.portsmith-setup-')));
});

test('conflicting donor versions and local donor specs never become registry additions', async (t) => {
  const f = await fixture(t);
  await saveJson(path.join(f.donor, 'package.json'), {
    workspaces: ['packages/*'],
    dependencies: { yaml: '2.8.1' }
  });
  await fs.mkdir(path.join(f.donor, 'packages/b'), { recursive: true });
  await saveJson(path.join(f.donor, 'packages/b/package.json'), {
    name: 'b',
    dependencies: { yaml: '1.0.0' }
  });
  assert.equal(
    (
      await executeCommand('discover-imports', {
        source: f.source,
        proposal: f.proposal,
        dependencySource: f.donor
      })
    ).status,
    'blocked'
  );
  await saveJson(path.join(f.donor, 'packages/b/package.json'), {
    name: 'b',
    dependencies: { yaml: '2.8.1' }
  });
  await saveJson(path.join(f.donor, 'package.json'), { dependencies: { yaml: 'file:/private/repo' } });
  assert.equal(
    (
      await executeCommand('discover-imports', {
        source: f.source,
        proposal: f.proposal,
        dependencySource: f.donor
      })
    ).status,
    'blocked'
  );
});
test('npm pre-freeze lock recovery is bounded and retains failed attempt evidence', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    f.shim,
    `#!${process.execPath}\nimport fs from 'node:fs';if(process.argv[2]==='--version')console.log('10.0.0');else if(process.argv.includes('--package-lock-only')){fs.writeFileSync('package-lock.json',JSON.stringify({lockfileVersion:3,packages:{}}));}else if(!fs.existsSync('failed')){fs.writeFileSync('failed','yes');console.error('npm error code EUSAGE');process.exit(1);}else fs.mkdirSync('node_modules');`,
    { mode: 0o700 }
  );
  const r = await executeCommand('setup-deps', f.input, { allowExecution: true });
  const receipt = await readJson(r.receipt);
  assert.deepEqual(
    receipt.executions.map((x) => x.phase),
    ['resolve', 'install', 'resolve-retry', 'install']
  );
  assert.equal(receipt.executions[1].exitCode, 1);
  assert.equal(receipt.recoveries.length, 1);
});

test('single-character workspace directories outrank root for discovery', async (t) => {
  const f = await fixture(t);
  await saveJson(path.join(f.source, 'package.json'), { workspaces: ['a'] });
  await fs.mkdir(path.join(f.source, 'a'));
  await saveJson(path.join(f.source, 'a/package.json'), { name: 'a', version: '1.0.0' });
  await saveJson(f.proposal, {
    edits: [{ path: 'a/new.ts', beforeSha256: null, content: "import x from 'yaml'" }]
  });
  const r = await executeCommand('discover-imports', {
    source: f.source,
    proposal: f.proposal,
    dependencySource: f.donor
  });
  assert.equal(r.additions[0].manifest, 'a/package.json');
});

test('prepared setup evidence cannot be altered by an integration proposal', async (t) => {
  const f = await fixture(t);
  const { fixture: transferFixture } = await import('../scripts/fixture.mjs');
  const input = await transferFixture(path.join(f.root, 'transfer'));
  for (const name of ['portsmith.setup.json', 'portsmith.setup.patch', 'portsmith.imports.json'])
    await fs.writeFile(path.join(input.target, name), 'original setup evidence');
  await executeCommand('prepare', input);
  for (const name of ['portsmith.setup.json', 'portsmith.setup.patch', 'portsmith.imports.json']) {
    const before = await inventory(path.join(input.out, 'candidate'));
    const proposal = path.join(f.root, 'tamper.json');
    await saveJson(proposal, {
      edits: [{ path: name, beforeSha256: before[name].sha256, content: 'forged setup evidence' }]
    });
    await assert.rejects(
      executeCommand('adapt', { run: input.out, proposal }),
      /protected|test|configuration/i
    );
    assert.deepEqual(await inventory(path.join(input.out, 'candidate')), before);
  }
});
