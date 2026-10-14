import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { executeCommand, commandResult } from '../src/index.mjs';
import { runProcess } from '../src/platform/process.mjs';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-discovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test('discovery ranks exports above body matches, excludes secrets and never executes source', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(
    path.join(root, 'named.mjs'),
    'throw Error("not executable"); export function searchTables() {}'
  );
  await fs.writeFile(path.join(root, 'body.mjs'), '// search tables\nexport const unrelated=1;');
  await fs.mkdir(path.join(root, '.env.private'));
  await fs.writeFile(path.join(root, '.env.private', 'secret.js'), 'export const searchTables="SECRET";');
  await fs.writeFile(path.join(root, 'bad.ts'), 'export function broken( {');
  await fs.symlink(path.join(root, 'named.mjs'), path.join(root, 'link.mjs'));
  const r = await executeCommand('discover', { source: root, query: 'search tables', limit: 1 });
  assert.equal(r.candidates[0].entry, 'named.mjs');
  assert.equal(r.totalMatches, 2);
  assert.equal(r.coverage.resultsTruncated, true);
  assert.equal(r.coverage.status, 'partial');
  assert.equal(r.coverage.omitted['parse-error'], 1);
  assert(!JSON.stringify(r).includes('SECRET'));
  const a = await executeCommand(r.candidates[0].inspect.command, r.candidates[0].inspect.input);
  assert.equal(a.exports[0].name, 'searchTables');
  assert.equal((await commandResult('discover', { source: root, limit: 0 })).ok, false);
  const cli = await runProcess(process.execPath, [
    'src/cli.mjs',
    'discover',
    '--source',
    root,
    '--query',
    'search',
    '--limit',
    '1',
    '--human'
  ]);
  assert.equal(cli.exitCode, 0, cli.stderr);
  assert.match(cli.stdout, /named.mjs/);
});
test('discovery reports oversized source and empty results as scoped observations', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'big.js'), ' '.repeat(512001));
  const r = await executeCommand('discover', { source: root, query: 'missing' });
  assert.equal(r.coverage.status, 'partial');
  assert.equal(r.coverage.omitted['file-size-limit'], 1);
  assert.equal(r.totalMatches, 0);
  assert(r.limitations.some((x) => x.includes('does not prove absence')));
});
test('init is non-overwriting, validates endpoints before writing and stays within MCP root', async (t) => {
  const root = await fixture(t),
    out = path.join(root, 'setup');
  const invalid = await commandResult('init', {
    out,
    model: 'test',
    baseURL: 'https://name:secret@example.org'
  });
  assert.equal(invalid.ok, false);
  await assert.rejects(fs.stat(out));
  const r = await executeCommand('init', { out, model: 'test' }, { root });
  assert.equal(r.status, 'created');
  await fs.writeFile(path.join(out, '.env'), 'PRIVATE_SENTINEL');
  assert.equal((await commandResult('init', { out, model: 'different' })).ok, false);
  assert.equal(await fs.readFile(path.join(out, '.env'), 'utf8'), 'PRIVATE_SENTINEL');
  assert.match(await fs.readFile(path.join(out, '.gitignore'), 'utf8'), /\.env/);
  assert.equal(
    (await commandResult('init', { out: path.join(os.tmpdir(), 'outside'), model: 'test' }, { root })).error
      .code,
    'outside_workspace'
  );
});
test('doctor reports unloaded keys, malformed configs and dependency readiness without exposing credentials', async (t) => {
  const root = await fixture(t),
    config = path.join(root, 'model.json');
  await fs.writeFile(
    config,
    JSON.stringify({
      model: 'test',
      baseURL: 'https://example.org/v1',
      apiKeyEnv: 'PORTSMITH_TEST_DOCTOR_SECRET'
    })
  );
  await fs.writeFile(path.join(root, '.env'), 'PORTSMITH_TEST_DOCTOR_SECRET=LOCAL_SECRET');
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      engines: { node: '>=24' },
      dependencies: { example: '1' },
      scripts: { install: 'must never run' }
    })
  );
  let r = await executeCommand('doctor', { workspace: root, config, target: root, browser: true });
  assert.equal(r.checks.find((c) => c.id === 'model-key').status, 'failed');
  assert.equal(r.checks.find((c) => c.id === 'destination').status, 'failed');
  assert.equal(r.destination.nodeEngine, '>=24');
  process.env.PORTSMITH_TEST_DOCTOR_SECRET = 'DO_NOT_PRINT';
  t.after(() => delete process.env.PORTSMITH_TEST_DOCTOR_SECRET);
  r = await executeCommand('doctor', { workspace: root, config });
  assert.equal(r.status, 'ready');
  assert(!JSON.stringify(r).includes('DO_NOT_PRINT'));
  await fs.writeFile(config, '{ secret content is malformed');
  r = await executeCommand('doctor', { workspace: root, config });
  assert.equal(r.status, 'not-ready');
  assert(!JSON.stringify(r).includes('secret content'));
});

test('discovery identifies named default classes without mistaking them for callable functions', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'core.js'), 'export default class Fuse { search() {} }');
  await fs.writeFile(path.join(root, 'FuseIndex.js'), 'export default class Index {}');
  const result = await executeCommand('discover', { source: root, query: 'Fuse' });
  assert.equal(result.candidates[0].entry, 'core.js');
  assert.deepEqual(result.candidates[0].exportedBindings, ['Fuse']);
  assert.equal(result.candidates[0].exports[0].callable, 'unknown');
});
