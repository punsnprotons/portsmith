// Re-stage the exact recorded live proposals after correcting upstream notice discovery.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { prepare, adapt, verify, exportPatch } from '../src/index.mjs';
import { readJson, saveJson, inventory } from '../src/platform/files.mjs';
const paired = await readJson('.portsmith/dynamic-bench/paired-latest.json'),
  setup = await readJson('.portsmith/dynamic-bench/setup-latest.json');
const root = await fs.mkdtemp(path.join(paired.root, 'notice-fix-')),
  results = [];
for (const old of paired.results) {
  assert.equal(old.status, 'verified-for-contract');
  const run = path.join(root, old.arm);
  await prepare({ ...setup, out: run });
  for (const side of ['source', 'baseline', 'candidate'])
    execFileSync('cp', [
      '-cR',
      path.join(old.run, side, 'node_modules'),
      path.join(run, side, 'node_modules')
    ]);
  const proposal = old.proposal ?? path.join(path.dirname(old.run), 'proposal-1.json');
  await adapt(run, proposal);
  const report = await verify(run, { allowExecution: true, timeoutMs: 120000 });
  assert.equal(report.status, 'verified-for-contract', JSON.stringify(report));
  assert.equal(
    await fs.readFile(path.join(run, 'candidate', setup.mount, 'MIT-LICENSE.txt'), 'utf8'),
    await fs.readFile(path.join(setup.source, 'MIT-LICENSE.txt'), 'utf8')
  );
  const patch = await exportPatch(run);
  results.push({
    ...old,
    run,
    patch,
    originalTrialRun: old.run,
    proposal,
    refresh:
      'Exact live proposal restaged without new model calls after prefixed license filename discovery fix.'
  });
  await saveJson(path.join(root, 'results.json'), results);
  console.log(old.arm, 'notice and export passed');
}
await saveJson(path.join(root, 'engine.json'), await inventory(path.resolve('src')));
await saveJson('.portsmith/dynamic-bench/paired-latest.json', { root, initialRoot: paired.root, results });
