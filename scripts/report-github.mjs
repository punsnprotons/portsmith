// Collect measured results; refuses to summarize unfinished integrations as passing.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { readJson, saveJson, inventory, same } from '../src/platform/files.mjs';
const base = path.resolve('.portsmith/github-bench');
const result = {
  version: '0.4.0',
  createdAt: new Date().toISOString(),
  scope: 'Two selected local real-repository tasks, not a reliability rate or Rea parity benchmark',
  integrations: [],
  runs: [],
  engine: []
};
for (const [node, log] of [
  ['22.19.0', 'node22-final-82.log'],
  ['23.10.0', 'final-check-82.log'],
  ['24.11.1', 'node24-final-82.log']
]) {
  const text = await fs.readFile(path.join(base, log), 'utf8');
  const count = (key) => Number(text.match(new RegExp('(?:ℹ|#) ' + key + ' (\\d+)'))?.[1]);
  const tests = count('tests'),
    passed = count('pass'),
    failed = count('fail'),
    skipped = count('skipped');
  assert.ok(tests > 0 && passed === tests && failed === 0 && skipped === 0);
  result.engine.push({ node, tests, passed, failed, skipped, log });
}
for (const name of ['it-tools', 'todomvc-es6']) {
  const setup = await readJson(path.join(base, `${name}-latest.json`));
  const report = await readJson(setup.run + '/verification.json');
  const auto = await readJson(setup.folder + '/result.json');
  const replay = await readJson(path.join(base, `${name}-replay-latest.json`));
  assert.equal(report.status, 'verified-for-contract');
  assert.equal(auto.status, 'verified-for-contract');
  assert.equal(replay.status, 'verified-for-contract');
  assert.equal(replay.original, setup.run);
  assert.equal(replay.productionBrowser, 'passed');
  const state = await readJson(setup.run + '/state.json');
  assert.ok(same(await inventory(state.analysis.source), state.sourceSnapshot));
  assert.ok(same(await inventory(state.analysis.target), state.targetSnapshot));
  const passed = (r) => r.cases.filter((x) => x.status === 'passed').length;
  result.integrations.push({
    name,
    run: setup.run,
    patch: auto.patch,
    sourceCases: passed(report.source),
    baselineCases: passed(report.baseline),
    candidateCases: passed(report.candidate),
    caseTotal: report.source.cases.length,
    regressions: report.regression.candidate.counts,
    browser: {
      cases: report.browser.candidate.cases.length,
      regressions: report.browser.candidate.regression.length,
      status: report.browser.status
    },
    checks: Object.fromEntries(
      Object.entries(report.checks).map(([side, checks]) => [
        side,
        checks.map(({ name, status }) => ({ name, status }))
      ])
    ),
    finalSessionAttempts: auto.attempts.length,
    model: auto.model,
    replay,
    originalsUnchanged: true
  });
}
for (const item of await fs.readdir(base, { withFileTypes: true })) {
  if (!item.isDirectory() || !/^(it-tools|todomvc-es6)-/.test(item.name)) continue;
  const run = path.join(base, item.name, 'run');
  let dirs;
  try {
    dirs = await fs.readdir(run);
  } catch {
    continue;
  }
  for (const dir of dirs.filter((d) => d.startsWith('autonomy-'))) {
    const summary = await readJson(path.join(run, dir, 'summary.json'));
    result.runs.push({
      run,
      session: dir,
      status: summary.status,
      reason: summary.reason,
      attempts: summary.attempts.map((a) => ({
        attempt: a.attempt,
        status: a.status,
        error: a.error?.message,
        tokens: a.usage?.total_tokens
      }))
    });
  }
}
await saveJson(path.join(base, 'results.json'), result);
console.log(
  result.integrations.map((x) => ({
    app: x.name,
    behavior: `${x.candidateCases}/${x.caseTotal}`,
    regressionTests: x.regressions.passed,
    browser: x.browser.status,
    replay: x.replay.status,
    productionBrowser: x.replay.productionBrowser
  }))
);
