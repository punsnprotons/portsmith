import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readJson, saveJson, inventory, hash, json, same } from '../src/platform/files.mjs';
const base = path.resolve('.portsmith/rea-comparison');
const directories = process.argv.slice(2);
assert(directories.length, 'Pass every paired run directory, including the pilot.');
const trials = [];
for (const directory of directories) {
  const root = path.resolve(directory);
  const protocol = await readJson(path.join(root, 'protocol.json'));
  const results = await readJson(path.join(root, 'results.json'));
  for (const name of new Set(results.map((x) => x.name))) {
    const arms = results.filter((r) => r.name === name);
    assert.equal(arms.length, 2);
    assert.equal(arms[0].initialCandidateInventorySha256, arms[1].initialCandidateInventorySha256);
    assert.equal(arms[0].contractSha256, arms[1].contractSha256);
  }
  for (const result of results) {
    assert.equal(result.status, 'verified-for-contract');
    const proof = await readJson(path.join(root, 'proof', result.name + '-' + result.arm, 'proof.json'));
    assert.equal(proof.replay.status, 'verified-for-contract');
    assert.equal(proof.browser.status, 'passed');
    assert.equal(proof.holdout.generatedCases, 600);
    assert.equal(proof.holdout.status, 'passed');
    const current = await inventory(path.join(result.run, 'candidate'));
    assert.equal(hash(json(current)), result.finalCandidateInventorySha256);
    assert.equal(hash(JSON.stringify(current)), proof.holdout.candidateInventorySha256);
    assert(same(current, await inventory(path.join(proof.replay.root, 'candidate'))));
    const verification = await readJson(path.join(result.run, 'verification.json'));
    assert.equal(verification.status, 'verified-for-contract');
    const v = await readJson(path.join(proof.replay.root, 'verification.json'));
    assert.equal(v.status, 'verified-for-contract');
    const contract = await readJson(path.join(result.run, 'contract.json'));
    assert.equal(hash(json(contract)), result.contractSha256);
    for (const a of result.attempts) {
      if (protocol.version >= 2) assert(a.proposal, 'Every valid model proposal must be retained');
    }
    trials.push({
      protocolVersion: protocol.version,
      root,
      name: result.name,
      arm: result.arm,
      status: result.status,
      attempts: result.attempts.length,
      totalTokens: result.attempts.reduce((n, a) => n + (a.usage?.total_tokens ?? 0), 0),
      wallMs: result.wallMs,
      sourceCases: verification.source.cases.length,
      candidateCases: verification.candidate.cases.length,
      regressions: verification.regression.candidate.counts.passed,
      proof,
      result
    });
  }
}
const originals = await readJson('.portsmith/complex-bench/originals.json');
for (const o of originals) {
  const cwd = path.resolve('.portsmith/complex-bench/repos', o.name);
  assert(same(await inventory(cwd), o.inventory));
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }), '');
}
const tests = [];
for (const file of ['check.log', 'node22.log', 'node24.log']) {
  const content = await fs.readFile(path.join(base, file), 'utf8');
  assert.match(content, /(?:ℹ|#) pass 93/);
  assert.match(content, /(?:ℹ|#) fail 0/);
  assert.match(content, /(?:ℹ|#) skipped 0/);
  tests.push({ file, passed: 93, sha256: hash(content) });
}
const staticResult = await readJson(path.join(base, 'static-latest.json'));
assert(staticResult.results.every((x) => x.originalUnchanged && !x.rea.error));
const focused = await readJson(path.join(base, 'focused-latest.json'));
assert(focused.unchanged);
const report = {
  date: new Date().toISOString(),
  comparison: 'Controlled evidence-assisted adaptation, not standalone agents or a reliability estimate',
  trials,
  static: staticResult,
  focused,
  originalsUnchanged: true,
  tests,
  engineInventory: await inventory(path.resolve('src')),
  limitations: [
    'Single paired trial per task plus an explicitly labeled Mermaid rerun. No statistical reliability or speed ranking.',
    'Rea supplies static evidence; the same Portsmith staging/model protocol and judge is used for both arms.',
    'Whole-app Rea coverage is partial; focused recovery does not replace that result.',
    'Online browser checks use public external assets. Full upstream end-to-end suites and deployed behavior are not covered.',
    'Pilot protected-edit proposals were not retained by the initial harness; revision 2 retains every proposal and exact rejection paths.'
  ]
};
await saveJson(path.join(base, 'results.json'), report);
console.log(
  JSON.stringify(
    {
      trials: trials.map(({ name, arm, protocolVersion, attempts, totalTokens, status }) => ({
        name,
        arm,
        protocolVersion,
        attempts,
        totalTokens,
        status
      })),
      originalsUnchanged: true,
      tests
    },
    null,
    2
  )
);
