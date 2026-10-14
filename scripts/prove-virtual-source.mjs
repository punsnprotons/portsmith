import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { runProcess } from '../src/platform/process.mjs';
import { readJson, saveJson, inventory, same } from '../src/platform/files.mjs';
const base = path.resolve('.portsmith/virtual-bench'),
  setup = await readJson(path.join(base, 'setup-latest.json'));
const before = await inventory(setup.source);
const run = async (args, label) => {
  const r = await runProcess(process.execPath, args, {
    cwd: setup.source,
    timeoutMs: 120000,
    maxOutputBytes: 1000000
  });
  await saveJson(path.join(base, label + '.json'), r);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(r.reason, null);
  return r;
};
await run(
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    'packages/jsondiffpatch/test',
    '--reporter=json',
    '--outputFile=' + path.join(base, 'upstream-tests.json')
  ],
  'upstream-execution'
);
const tests = await readJson(path.join(base, 'upstream-tests.json'));
assert.equal(tests.numPassedTests, 412);
assert.equal(tests.numFailedTests, 0);
assert.equal(tests.numPendingTests, 0);
await run(['node_modules/vite/bin/vite.js', 'build'], 'source-build');
const files = (await fs.readdir(path.join(setup.source, 'dist'))).filter(
  (f) => f.endsWith('.mjs') || f.endsWith('.js')
);
assert.equal(files.length, 1, files.join(','));
const bundle = await import(pathToFileURL(path.join(setup.source, 'dist', files[0])));
const contract = await readJson(setup.contract);
for (const c of contract.cases) assert.deepEqual(await bundle.stateHistory(...c.sourceArgs), c.expected);
assert(same(before, await inventory(setup.source)));
await saveJson(path.join(base, 'source-proof.json'), {
  upstreamTests: tests.numPassedTests,
  productionBuild: 'passed',
  actualBundledBehaviorCases: contract.cases.length,
  sourceUnchanged: true
});
console.log('SOURCE', tests.numPassedTests, 'BUNDLED', contract.cases.length);
