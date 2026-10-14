import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readJson, saveJson, inventory, same, hash } from '../src/platform/files.mjs';
const base = path.resolve('.portsmith/complex-bench'),
  results = [];
for (const name of ['drawdb', 'mermaid-live-editor']) {
  const setup = await readJson(path.join(base, `${name}-latest.json`));
  const result = await readJson(path.join(setup.folder, 'result.json'));
  const verification = await readJson(path.join(setup.run, 'verification.json'));
  const replay = await readJson(path.join(base, `${name}-replay-latest.json`));
  const browser = await readJson(path.join(base, `${name}-browser-latest.json`));
  const holdout = await readJson(path.join(base, `${name}-holdout.json`));
  assert.equal(result.status, 'verified-for-contract');
  assert.equal(replay.status, 'verified-for-contract');
  assert.equal(browser.status, 'passed');
  assert.equal(holdout.status, 'passed');
  assert.equal(
    holdout.candidateInventorySha256,
    hash(JSON.stringify(await inventory(path.join(setup.run, 'candidate'))))
  );
  results.push({
    name,
    run: setup.run,
    verificationVersion: verification.version,
    source: verification.source.cases.length,
    before: verification.baseline.cases.filter((x) => x.status === 'passed').length,
    after: verification.candidate.cases.filter((x) => x.status === 'passed').length,
    regressions: verification.regression.candidate.counts.passed,
    regressionOrigin: name === 'drawdb' ? 'authored' : 'upstream',
    checks: verification.checks.candidate.map((x) => ({ name: x.name, status: x.status })),
    patch: result.patch,
    replay,
    browser,
    holdout
  });
}
const sessions = [];
for (const item of await fs.readdir(base, { withFileTypes: true })) {
  if (!item.isDirectory()) continue;
  const run = path.join(base, item.name, 'run');
  let folders;
  try {
    folders = await fs.readdir(run);
  } catch {
    continue;
  }
  for (const folder of folders.filter((x) => x.startsWith('autonomy-'))) {
    const s = await readJson(path.join(run, folder, 'summary.json'));
    sessions.push({
      run,
      status: s.status,
      blockers: s.blockers,
      attempts: s.attempts.map((a) => ({
        attempt: a.attempt,
        status: a.status,
        error: a.error,
        usage: a.usage
      })),
      evidence: s.evidence
    });
  }
}
const originals = await readJson(path.join(base, 'originals.json'));
for (const item of originals) {
  const cwd = path.join(base, 'repos', item.name);
  assert.ok(same(await inventory(cwd), item.inventory), item.name + ' source inventory changed');
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }), '');
}
const tests = [];
for (const file of ['check-final.log', 'node22-final.log', 'node24-final.log']) {
  const log = await fs.readFile(path.join(base, file), 'utf8');
  const passed = Number(log.match(/(?:ℹ|#) pass (\d+)/)?.[1]);
  assert.ok(passed > 0);
  assert.match(log, /(?:ℹ|#) fail 0/);
  assert.match(log, /(?:ℹ|#) skipped 0/);
  tests.push({ file, passed, failed: 0, skipped: 0, sha256: hash(log) });
}
const report = {
  date: new Date().toISOString(),
  version: (await readJson('package.json')).version,
  scope:
    'Two new whole-app builds and selected feature transfers; not parity with Rea or a general success-rate estimate.',
  results,
  sessions,
  originals: originals.map(({ inventory, ...x }) => ({ ...x, unchanged: true })),
  engineTests: tests,
  limitations: [
    'Authored drawDB regressions are not upstream tests.',
    'Online production browser scenarios are supplemental, not frozen browser-contract evidence. Strict local-only runs failed on external assets/schema and remain retained.',
    'Installed dependencies reused for replay; no clean-room install attestation.',
    'Mermaid setup redirects adapter output to build/; scripts and Svelte metadata are frozen/generated before verification.',
    'No upstream full end-to-end suite, cross-framework conversion, cloud deployment or Rea parity measured.'
  ]
};
await saveJson(path.join(base, 'results.json'), report);
console.log(
  JSON.stringify(
    {
      results: results.map((x) => ({
        name: x.name,
        before: x.before,
        after: x.after,
        regressions: x.regressions,
        browser: x.browser.status
      })),
      engineTests: tests
    },
    null,
    2
  )
);
