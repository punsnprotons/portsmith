// Controlled Rea-assisted vs Portsmith-assisted adaptation; not a standalone agent contest.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { prepare, adapt, verify, exportPatch, executeCommand } from '../src/index.mjs';
import { loadRun, protectedFile } from '../src/application/transfer.mjs';
import { modelContext, assertAutonomousProposal } from '../src/application/autonomous.mjs';
import { modelConfig, propose } from '../src/providers/model/client.mjs';
import { analyze } from '../src/providers/javascript/analyze.mjs';
import { readJson, saveJson, inventory, hash, json } from '../src/platform/files.mjs';
import { runProcess } from '../src/platform/process.mjs';
import { regressionFiles } from '../src/providers/node/regression.mjs';
const base = path.resolve('.portsmith/workspace-bench');
const setup = await readJson(path.join(base, 'setup-latest.json'));
const root = await fs.mkdtemp(path.join(base, 'paired-'));
const { folder: staticFolder, results: staticResults } = await readJson(
  path.join(base, 'static-latest.json')
);
const protocol = {
  version: 1,
  createdAt: new Date().toISOString(),
  model: 'gpt-5.6-terra',
  maxAttempts: 3,
  maxOutputTokens: 8000,
  scope:
    'One paired trial per app. Common Portsmith staging, prompt, model protocol, file context, tests and export judge. The experimental difference is static evidence. This is not a standalone Rea agent or a statistically powered reliability comparison.',
  order: [
    ['shared-state-validation', 'portsmith'],
    ['shared-state-validation', 'rea']
  ],
  staticFolder,
  engineInventory: await inventory(path.resolve('src')),
  holdouts:
    'Independent generated shared-state cases, visible diagram/share/reload checks and fresh patch replay after proposals.'
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
    trace: (() => {
      const t = e.rea.trace.normalized_result;
      return {
        ...t,
        graph: {
          ...t.graph,
          limitations: t.graph.limitations?.slice(0, 20),
          limitationCount: t.graph.limitations?.length,
          nodes: t.graph.nodes?.slice(0, 20),
          edges: t.graph.edges?.slice(0, 30)
        },
        paths: t.paths?.slice(0, 10)
      };
    })(),
    projection:
      'Bounded model projection: first 20 trace nodes, 30 edges, 10 paths and 20 graph limitations; full trace retained in staticFolder. Summary statistics and partial coverage plus top-level trace limitations retained. No claim of complete semantic coverage.'
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
  await executeCommand(
    'install-deps',
    {
      run,
      allowExecution: true,
      managerBin: path.resolve('.portsmith/dependency-bench/tools/node_modules/pnpm/bin/pnpm.cjs')
    },
    { allowExecution: true }
  );
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
        'Connect the destination isValidSharedState helper to the transplanted Zod-backed bridge. The existing serde consumer already calls this helper. Preserve valid legacy and future-field states; reject malformed state shapes without rewriting the source implementation. Preserve original source files, framework aliases, manifests, tests and configuration. Full Svelte/TypeScript checks and editor/embed builds must pass. Use the native $lib alias or relative imports.';
      input.staticEvidence =
        arm === 'rea'
          ? {
              provider: 'rea',
              source: projection('zod'),
              destination: projection('mermaid-live-editor')
            }
          : {
              provider: 'portsmith',
              source: {
                ...context.state.analysis,
                exports: context.state.analysis.exports.slice(0, 40),
                projection: {
                  retainedExports: 40,
                  totalExports: context.state.analysis.exports.length,
                  policy:
                    'First 40 static export records; all source code, file list and import edges retained. Full analysis remains in state.json.'
                }
              },
              destination: await readJson(path.join(staticFolder, 'mermaid-live-editor-portsmith.json'))
            };
      assert(Buffer.byteLength(JSON.stringify(input)) <= config.maxContextBytes);
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
      await assertAutonomousProposal(context, generated.proposal);
      await adapt(run, proposal);
      const graph = await analyze({
        source: path.join(run, 'candidate'),
        target: path.join(run, 'baseline'),
        entry: context.contract.target.module,
        runtimeOnly: true,
        aliases: true
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
for (const name of ['shared-state-validation']) {
  const arms = results.filter((r) => r.name === name);
  if (!arms.length) continue;
  assert.equal(arms[0].initialCandidateInventorySha256, arms[1].initialCandidateInventorySha256);
  assert.equal(arms[0].contractSha256, arms[1].contractSha256);
}
await saveJson(path.join(base, 'paired-latest.json'), { root, results });
console.log('DONE', root);
