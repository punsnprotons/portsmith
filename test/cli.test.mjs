import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fixture, project } from '../scripts/fixture.mjs';
import { runProcess } from '../src/platform/process.mjs';

test('installed-style CLI explicitly loads a private env file without printing its key', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith env '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const envFile = path.join(root, '.env');
  const config = path.join(root, 'model.json');
  const key = 'local-test-value-not-a-real-key';
  await fs.writeFile(envFile, `PORTSMITH_CLI_TEST_KEY=${key}\n`);
  await fs.writeFile(
    config,
    JSON.stringify({
      model: 'test',
      baseURL: 'https://api.openai.com/v1',
      apiKeyEnv: 'PORTSMITH_CLI_TEST_KEY'
    })
  );
  const args = [path.join(project, 'src/cli.mjs'), 'doctor', '--config', config, '--json'];
  const missing = await runProcess(process.execPath, args, { cwd: root });
  assert.equal(missing.exitCode, 1);
  const loaded = await runProcess(process.execPath, [...args, '--env', envFile], { cwd: root });
  assert.equal(loaded.exitCode, 0, loaded.stderr);
  assert.equal(JSON.parse(loaded.stdout).checks.find((c) => c.id === 'model-key').status, 'passed');
  assert(!(loaded.stdout + loaded.stderr).includes(key));
  const absent = await runProcess(process.execPath, [...args, '--env', path.join(root, 'missing.env')], {
    cwd: root
  });
  assert.equal(absent.exitCode, 1);
});

test('CLI completes inspect → prepare → adapt → verify → export through a path with spaces', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith cli '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = await fixture(root);
  const cli = async (...args) => {
    const result = await runProcess(process.execPath, [path.join(project, 'src/cli.mjs'), ...args], {
      cwd: root
    });
    assert.equal(result.exitCode, 0, result.stderr + result.stdout);
    return JSON.parse(result.stdout);
  };
  const input = [
    '--source',
    options.source,
    '--target',
    options.target,
    '--entry',
    options.entry,
    '--mount',
    options.mount
  ];
  assert.equal((await cli('inspect', ...input)).files.length, 2);
  await cli('prepare', ...input, '--contract', options.contract, '--out', options.out);
  const denied = await runProcess(
    process.execPath,
    [path.join(project, 'src/cli.mjs'), 'verify', '--run', options.out],
    { cwd: root }
  );
  assert.equal(denied.exitCode, 1);
  await cli('adapt', '--run', options.out, '--proposal', path.join(root, 'proposal.json'));
  assert.equal(
    (await cli('verify', '--run', options.out, '--allow-execution')).status,
    'verified-for-contract'
  );
  const patch = await cli('export', '--run', options.out);
  assert.equal((await cli('status', '--run', options.out)).verification.stale, false);
  const apply = await runProcess('git', ['apply', patch.patch], { cwd: options.target });
  assert.equal(apply.exitCode, 0, apply.stderr);
  const { searchCatalog } = await import(path.join(options.target, 'src/catalog.mjs'));
  assert.deepEqual(searchCatalog('CAFE'), [{ id: 1, name: 'Café beans' }]);
});
