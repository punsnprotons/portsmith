import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readJson, saveJson, inventory, hash, json, same } from '../src/platform/files.mjs';
const base = path.resolve('.portsmith/search-bench');
const setup = await readJson(path.join(base, 'setup-latest.json'));
const { root, results } = await readJson(path.join(base, 'paired-latest.json'));
assert.equal(results.length, 2);
assert.equal(results[0].contractSha256, results[1].contractSha256);
assert.equal(results[0].initialCandidateInventorySha256, results[1].initialCandidateInventorySha256);
const rows = [];
for (const r of results) {
  assert.equal(r.status, 'verified-for-contract');
  const proof = await readJson(path.join(root, r.arm + '-proof.json'));
  assert.equal(proof.status, 'passed');
  const verification = await readJson(path.join(r.run, 'verification.json'));
  assert.equal(verification.status, 'verified-for-contract');
  assert.equal(verification.baselineDemonstratesGap, true);
  const replay = await readJson(path.join(proof.folder, 'drawdb-replay-latest.json'));
  assert.equal(replay.status, 'verified-for-contract');
  assert(
    same(await inventory(path.join(replay.root, 'candidate')), await inventory(path.join(r.run, 'candidate')))
  );
  assert.equal(hash(json(await inventory(path.join(r.run, 'candidate')))), r.finalCandidateInventorySha256);
  const holdouts = await readJson(path.join(proof.folder, 'holdouts/results.json'));
  for (const side of ['source', 'candidate'])
    assert.equal(holdouts.results.find((x) => x.side === side).passed, 500);
  const browser = {};
  for (const side of ['baseline', 'candidate']) {
    browser[side] = await readJson(path.join(proof.browser, side + '.json'));
    assert.equal(browser[side].status, 'passed');
    assert.deepEqual(browser[side].errors, []);
    assert.equal(verification.regression[side].counts.passed, 22);
    assert(verification.checks[side].every((c) => c.status === 'passed'));
  }
  rows.push({
    arm: r.arm,
    attempts: r.attempts.length,
    behavior: Object.fromEntries(
      ['source', 'baseline', 'candidate'].map((side) => [
        side,
        {
          passed: verification[side].cases.filter((c) => c.status === 'passed').length,
          total: verification[side].cases.length
        }
      ])
    ),
    regressions: 22,
    holdouts: 500,
    browser: 'passed',
    patchReplay: 'passed',
    proof: proof.folder,
    browserEvidence: proof.browser,
    patch: r.patch,
    modelTokens: r.attempts.reduce((sum, a) => sum + (a.usage?.total_tokens ?? 0), 0),
    elapsedMs: r.wallMs
  });
}
const originals = await readJson('.portsmith/complex-bench/originals.json');
const drawdb = originals.find((x) => x.name === 'drawdb');
assert(same(setup.sourceInventory, await inventory(setup.originalSource)));
assert(same(drawdb.inventory, await inventory(path.resolve('.portsmith/complex-bench/repos/drawdb'))));
for (const repo of [setup.originalSource, path.resolve('.portsmith/complex-bench/repos/drawdb')])
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }), '');
const report = {
  createdAt: new Date().toISOString(),
  root,
  sourceCommit: setup.sourceCommit,
  targetCommit: drawdb.commit,
  sourceFiles: 34,
  authoredSourceBridges: 1,
  originalsUnchanged: true,
  rows,
  scope:
    'One paired trial with common Portsmith staging/model/judge. Supplemental online browser proof. Not a standalone Rea agent contest or a statistical reliability estimate.',
  pilot: path.join(base, 'paired-JRtxU2'),
  limitations: [
    'Authored source callable bridge and baseline predicate extraction. All 22 destination regression tests are authored; drawDB has no upstream suite.',
    'Only Fuse fuzzy string search is exercised; its entire upstream suite and other search modes are not covered.',
    'The same 500 held-out inputs are reused for both candidates, not 1000 distinct cases.',
    'Both live Rea whole-repository analyses report partial application/semantic coverage. Static inventory or export discovery is not runtime proof.',
    'Dependencies are cloned from the prior provisioned drawDB baseline. Dependency provisioning is still manual.'
  ]
};
await saveJson(path.join(base, 'results.json'), report);
console.log(
  JSON.stringify(
    {
      originalsUnchanged: true,
      rows: rows.map(({ arm, attempts, behavior, regressions, holdouts, browser, patchReplay }) => ({
        arm,
        attempts,
        behavior,
        regressions,
        holdouts,
        browser,
        patchReplay
      }))
    },
    null,
    2
  )
);
