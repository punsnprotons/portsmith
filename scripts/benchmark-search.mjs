// Controlled Rea-assisted vs Portsmith-assisted adaptation; not a standalone agent contest.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { prepare, adapt, verify, exportPatch } from '../src/index.mjs';
import { loadRun, protectedFile } from '../src/application/transfer.mjs';
import { modelContext } from '../src/application/autonomous.mjs';
import { modelConfig, propose } from '../src/providers/model/client.mjs';
import { analyze } from '../src/providers/javascript/analyze.mjs';
import { readJson, saveJson, inventory, hash, json } from '../src/platform/files.mjs';
import { regressionFiles } from '../src/providers/node/regression.mjs';
const base = path.resolve('.portsmith/search-bench');
const setup = await readJson(path.join(base, 'setup-latest.json'));
const root = await fs.mkdtemp(path.join(base, 'paired-'));
const { folder: staticFolder, results: staticResults } = await readJson(
  path.join(base, 'static-latest.json')
);
const protocol = {
  version: 3,
  createdAt: new Date().toISOString(),
  model: 'gpt-5.6-terra',
  maxAttempts: 3,
  maxOutputTokens: 8000,
  scope:
    'One paired trial per app. Common Portsmith staging, prompt, model protocol, file context, tests and export judge. The experimental difference is static evidence. This is not a standalone Rea agent or a statistically powered reliability comparison.',
  order: [
    ['fuzzy-search', 'portsmith'],
    ['fuzzy-search', 'rea']
  ],
  staticFolder,
  changes:
    'Revision 3 adds the same explicit visible-search goal to both arms after pilot browser tests showed Semi UI leaves unmatched nodes visible by default.',
  engineInventory: await inventory(path.resolve('src')),
  holdouts:
    '500 independently seeded typo/no-match checks per candidate, plus visible baseline/candidate browser tests and fresh patch replay after proposals.'
};
await saveJson(path.join(root, 'protocol.json'), protocol);
const results = [];
function projection(name) {
  const e = staticResults.find((x) => x.name === name);
  assert(!e.rea.error);
  const s = e.rea.summary;
  return {
    name,
    summaryEvidenceId: s.evidence_id,
    parentEvidenceId: s.normalized_result.parent_evidence_id,
    statistics: s.normalized_result.summary.statistics,
    coverage: s.normalized_result.summary.coverage,
    trace: e.rea.trace,
    projection:
      'The complete summary, module pages and trace are retained in staticFolder. Summary includes statistics/coverage; detailed summary limitations are not duplicated here. Trace limitations are included in full.'
  };
}
for (const [name, arm] of protocol.order) {
  const start = performance.now();
  const prior = setup;
  const folder = path.join(root, name + '-' + arm);
  await fs.mkdir(folder);
  const run = path.join(folder, 'run');
  await prepare({
    source: setup.source,
    target: setup.target,
    entry: setup.entry,
    mount: setup.mount,
    contract: setup.contract,
    out: run
  });
  assert.equal(
    await fs.readFile(path.join(run, 'contract.json'), 'utf8'),
    await fs.readFile(setup.contract, 'utf8')
  );
  for (const side of ['baseline', 'candidate']) {
    execFileSync('cp', ['-cR', setup.dependencies, path.join(run, side, 'node_modules')]);
    if (name === 'mermaid-live-editor')
      execFileSync(process.execPath, ['node_modules/@sveltejs/kit/svelte-kit.js', 'sync'], {
        cwd: path.join(run, side),
        stdio: 'pipe'
      });
  }
  const config = modelConfig(await readJson(prior.config));
  const context = await loadRun(run);
  const record = {
    name,
    arm,
    run,
    contractSha256: hash(json(context.contract)),
    initialCandidateInventorySha256: hash(json(await inventory(path.join(run, 'candidate')))),
    attempts: [],
    setupMs: Math.round(performance.now() - start),
    status: 'running'
  };
  results.push(record);
  await saveJson(path.join(root, 'results.json'), results);
  console.log('START', name, arm);
  let report = await verify(run, { allowExecution: true, timeoutMs: 120000 });
  await saveJson(path.join(folder, 'initial-verification.json'), report);
  assert.equal(report.source.status, 'passed');
  assert.equal(report.baselineDemonstratesGap, true);
  assert.equal(report.regression.baseline.status, 'passed');
  assert(report.checks.baseline.every((c) => c.status === 'passed'));
  let error = {
    code: 'feature_not_connected',
    message: 'Import and call the transferred implementation; do not reimplement it.'
  };
  for (let n = 1; n <= 3; n++) {
    const attempt = { attempt: n };
    record.attempts.push(attempt);
    try {
      const input = await modelContext(context, report, error, config);
      input.integrationGoal =
        'Integrate fuzzy search into the existing TablesTab/SearchBar.jsx TreeSelect, not only its callable helper. While searching show only matching tables/columns and their ancestors; an unrelated query must display the existing emptyContent. Clearing restores all nodes. Selecting a matching column must still focus its original input. Preserve existing selection and saved schema behavior. The source Fuse implementation and source bridge are immutable.';
      input.staticEvidence =
        arm === 'rea'
          ? {
              provider: 'rea',
              source: projection('fuse'),
              destination: projection('drawdb')
            }
          : {
              provider: 'portsmith',
              source: context.state.analysis,
              destination: await readJson(path.join(staticFolder, 'drawdb-portsmith.json'))
            };
      assert(Buffer.byteLength(json(input)) <= config.maxContextBytes);
      await saveJson(path.join(folder, `attempt-${n}-context.json`), input);
      const requestStart = performance.now();
      const generated = await propose(config, input);
      attempt.modelMs = Math.round(performance.now() - requestStart);
      attempt.model = generated.model;
      attempt.usage = generated.usage;
      attempt.contextSha256 = hash(json(input));
      const proposal = path.join(folder, `attempt-${n}-proposal.json`);
      await saveJson(proposal, generated.proposal);
      attempt.proposal = proposal;
      const edits = generated.proposal.edits;
      for (const edit of edits) {
        if (
          protectedFile(edit.path) ||
          regressionFiles(context.contract.regression).includes(edit.path) ||
          edit.path === context.state.analysis.mount ||
          edit.path.startsWith(context.state.analysis.mount + '/')
        )
          throw Error(
            `Protected file: ${edit.path}. Adapt destination implementation outside the feature mount; preserve original source, tests, manifests and notices.`
          );
      }
      await adapt(run, proposal);
      const graph = await analyze({
        source: path.join(run, 'candidate'),
        target: path.join(run, 'baseline'),
        entry: context.contract.target.module,
        runtimeOnly: true
      });
      assert.equal(graph.blockers.length, 0, graph.blockers.join('\n'));
      assert(
        graph.files.some((f) => f.path === context.state.analysis.mount + '/' + context.state.analysis.entry),
        'Feature not connected'
      );
      report = await verify(run, { allowExecution: true, timeoutMs: 120000 });
      await saveJson(path.join(folder, `attempt-${n}-verification.json`), report);
      attempt.status = report.status;
      error = null;
      if (report.status === 'verified-for-contract') {
        record.patch = await exportPatch(run);
        record.status = report.status;
        break;
      }
      if (report.integrity.status !== 'passed') throw Error('Integrity failed');
    } catch (e) {
      attempt.status = 'rejected';
      attempt.error = e.message;
      error = { message: e.message };
    }
    await saveJson(path.join(root, 'results.json'), results);
  }
  if (record.status === 'running') record.status = 'attempts-exhausted';
  record.wallMs = Math.round(performance.now() - start);
  record.finalCandidateInventorySha256 = hash(json(await inventory(path.join(run, 'candidate'))));
  await saveJson(path.join(root, 'results.json'), results);
  console.log('END', name, arm, record.status, record.attempts.length, record.wallMs);
}
for (const name of ['fuzzy-search']) {
  const arms = results.filter((r) => r.name === name);
  if (!arms.length) continue;
  assert.equal(arms[0].initialCandidateInventorySha256, arms[1].initialCandidateInventorySha256);
  assert.equal(arms[0].contractSha256, arms[1].contractSha256);
}
await saveJson(path.join(base, 'paired-latest.json'), { root, results });
console.log('DONE', root);
