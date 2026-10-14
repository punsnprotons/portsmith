import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fixture, project } from '../scripts/fixture.mjs';
import { runProcess } from '../src/platform/process.mjs';

test('CLI completes inspect → prepare → adapt → verify → export through a path with spaces', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith cli '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = await fixture(root);
  const cli = async (...args) => {
    const result = await runProcess(process.execPath, [path.join(project, 'src/cli.mjs'), ...args], { cwd: root });
    assert.equal(result.exitCode, 0, result.stderr + result.stdout);
    return JSON.parse(result.stdout);
  };
  const input = ['--source', options.source, '--target', options.target, '--entry', options.entry, '--mount', options.mount];
  assert.equal((await cli('inspect', ...input)).files.length, 2);
  await cli('prepare', ...input, '--contract', options.contract, '--out', options.out);
  const denied = await runProcess(process.execPath, [path.join(project, 'src/cli.mjs'), 'verify', '--run', options.out], { cwd: root });
  assert.equal(denied.exitCode, 1);
  await cli('adapt', '--run', options.out, '--proposal', path.join(root, 'proposal.json'));
  assert.equal((await cli('verify', '--run', options.out, '--allow-execution')).status, 'verified-for-contract');
  const patch = await cli('export', '--run', options.out);
  assert.equal((await cli('status', '--run', options.out)).verification.stale, false);
  const apply = await runProcess('git', ['apply', patch.patch], { cwd: options.target });
  assert.equal(apply.exitCode, 0, apply.stderr);
  const { searchCatalog } = await import(path.join(options.target, 'src/catalog.mjs'));
  assert.deepEqual(searchCatalog('CAFE'), [{ id: 1, name: 'Café beans' }]);
});
