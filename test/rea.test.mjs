import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fixture, project } from '../scripts/fixture.mjs';
import { saveJson } from '../src/platform/files.mjs';
import { prepare, loadRun, assertIntegrity, adapt, verify, exportPatch } from '../src/application/transfer.mjs';
import { traceWithRea, reaAttachment } from '../src/providers/rea/client.mjs';

async function setup(t, mode = 'pass') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-rea-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = await fixture(root);
  await prepare(options);
  const context = await loadRun(options.out);
  const configFile = path.join(root, 'rea.json');
  await saveJson(configFile, { command: process.execPath, args: [path.join(project, 'test/fixtures/rea-server.mjs'), mode] });
  return { root, options, context, args: { ...context, configFile, allowExecution: true, checkIntegrity: () => assertIntegrity(context) } };
}

test('Rea adapter retains exact linked evidence without replacing behavior verification', async t => {
  const { root, options, context, args } = await setup(t);
  const result = await traceWithRea(args);
  assert.equal(result.server.name, 'rea-protocol-double');
  assert.equal(result.facts.matched_seeds, 1);
  assert.deepEqual(await reaAttachment(context.run, context.state), result);
  assert.equal((await verify(context.run, { allowExecution: true })).status, 'failed');
  await adapt(context.run, path.join(root, 'proposal.json'));
  const report = await verify(context.run, { allowExecution: true });
  assert.equal(report.status, 'verified-for-contract');
  assert.equal(report.upstreamAnalysis.traceEvidenceId, result.traceEvidenceId);
  assert.equal((await exportPatch(options.out)).status, 'patch-ready');
  await fs.appendFile(path.join(context.run, 'rea-evidence.json'), ' ');
  await assert.rejects(exportPatch(options.out), /stale or changed/);
});

for (const mode of ['error', 'wrong-source', 'no-match']) {
  test(`Rea ${mode} does not produce a successful attachment`, async t => {
    const { context, args } = await setup(t, mode);
    await assert.rejects(traceWithRea(args), /failed|different application|did not match/);
    assert.equal(await reaAttachment(context.run, context.state), null);
  });
}

test('starting Rea requires execution authorization', async t => {
  const { args } = await setup(t);
  await assert.rejects(traceWithRea({ ...args, allowExecution: false }), /allow-execution/);
});
