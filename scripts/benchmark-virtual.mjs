// Live paired evidence-assisted model trial; common Portsmith executor and acceptance gates.
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { prepare, adapt, verify, exportPatch, analyze } from '../src/index.mjs';
import { loadRun } from '../src/application/transfer.mjs';
import { modelContext, assertAutonomousProposal } from '../src/application/autonomous.mjs';
import { modelConfig, propose } from '../src/providers/model/client.mjs';
import { readJson, saveJson, hash, json, inventory } from '../src/platform/files.mjs';
const base = path.resolve('.portsmith/virtual-bench'),
  setup = await readJson(path.join(base, 'setup-latest.json')),
  staticData = await readJson(path.join(base, 'static-latest.json'));
const root = await fs.mkdtemp(path.join(base, 'paired-')),
  results = [];
await saveJson(path.join(root, 'protocol.json'), {
  model: 'gpt-5.6-terra',
  attempts: 3,
  scope:
    'One paired trial, same prepared source/target, model, complete feature context, frozen contracts and Portsmith execution/export judge. Difference is projected static evidence only; not standalone Rea agent performance.',
  staticFolder: staticData.folder,
  engine: await inventory(path.resolve('src')),
  manualDependencyProvisioning:
    'Byte copies of reviewed existing app install and pinned Vite/plugin tools; not a fresh lockfile installation test.',
  goal: 'Virtual-module-backed JSON diff engine, new YAML package import and multi-document API adaptation, plus existing drawDB Issues equality consumer.'
});
function projection(record) {
  assert(!record.rea.error, record.rea.error);
  const s = record.rea.summary.normalized_result,
    t = record.rea.trace.normalized_result;
  return {
    name: record.name,
    summary: s.summary,
    trace: {
      ...t,
      graph: {
        ...t.graph,
        nodes: t.graph.nodes?.slice(0, 20),
        edges: t.graph.edges?.slice(0, 30),
        limitations: t.graph.limitations?.slice(0, 20),
        limitationCount: t.graph.limitations?.length
      },
      paths: t.paths?.slice(0, 10)
    },
    projection:
      'First 20 nodes, 30 edges, 10 paths and 20 graph limitations; statistics and coverage retained; full raw evidence retained.',
    rawEvidenceFolder: staticData.folder
  };
}
for (const arm of ['portsmith', 'rea']) {
  const folder = path.join(root, arm);
  await fs.mkdir(folder);
  const run = path.join(folder, 'run');
  await prepare({ ...setup, out: run });
  for (const side of ['source', 'baseline', 'candidate'])
    execFileSync('cp', [
      '-cR',
      path.join(side === 'source' ? setup.source : setup.target, 'node_modules'),
      path.join(run, side, 'node_modules')
    ]);
  const context = await loadRun(run),
    config = modelConfig(await readJson(setup.config));
  const record = {
    arm,
    run,
    attempts: [],
    contractSha256: hash(json(context.contract)),
    initialInventorySha256: hash(json(await inventory(path.join(run, 'candidate'))))
  };
  results.push(record);
  let report = await verify(run, { allowExecution: true, timeoutMs: 120000 });
  await saveJson(path.join(folder, 'initial-verification.json'), report);
  console.log(
    arm,
    'INITIAL',
    report.source.status,
    report.baselineDemonstratesGap,
    report.regression.baseline.status,
    report.checks.baseline.map((c) => c.status)
  );
  assert.equal(report.source.status, 'passed', JSON.stringify(report.source));
  assert.equal(report.baselineDemonstratesGap, true);
  assert.equal(report.regression.baseline.status, 'passed');
  assert(report.checks.baseline.every((c) => c.status === 'passed'));
  let error = {
    message:
      'Connect destination deltaHistory exports to the immutable transferred engine. The stateHistory destination API now accepts one YAML multi-document string, while the source API accepts an array of JSON states. Use the newly captured yaml package import in src/utils/deltaHistory.js to parse all documents, then call the transferred history implementation. Preserve statesEqual and the existing Issues consumer.'
  };
  for (let n = 1; n <= 3; n++) {
    const attempt = { n };
    record.attempts.push(attempt);
    try {
      const input = await modelContext(context, report, error, config);
      input.integrationGoal =
        'Implement src/utils/deltaHistory.js stateHistory(documents) by importing parseAllDocuments from yaml, parsing every YAML document to JSON, rejecting parse errors and an empty stream, then delegating to immutable transferred stateHistory(states). Source stateHistory expects an array, destination expects a YAML multi-document string. The yaml import is pre-captured for this exact destination file and newly provisioned at 2.8.1. Delegate statesEqual to the transferred engine, preserving src/utils/utils.js arrayIsEqual. Use relative imports to the transferred feature; do not add YAML parsing to the source. No reimplementation, source edits, test/config changes, or type suppression. Preserve both diff/patch/unpatch behavior and original application utilities.';
      input.staticEvidence =
        arm === 'rea'
          ? { provider: 'rea', repos: staticData.results.map(projection) }
          : {
              provider: 'portsmith',
              source: context.state.analysis,
              destination: await readJson(path.join(staticData.folder, 'drawdb-portsmith.json'))
            };
      assert(Buffer.byteLength(json(input)) <= config.maxContextBytes, 'context exceeds bound');
      await saveJson(path.join(folder, `context-${n}.json`), input);
      const generated = await propose(config, input);
      attempt.model = generated.model;
      attempt.usage = generated.usage;
      await assertAutonomousProposal(context, generated.proposal);
      const proposal = path.join(folder, `proposal-${n}.json`);
      await saveJson(proposal, generated.proposal);
      await adapt(run, proposal);
      for (const entry of [setup.targetEntry, 'src/utils/utils.js']) {
        const graph = await analyze({
          source: path.join(run, 'candidate'),
          target: path.join(run, 'baseline'),
          entry,
          aliases: true,
          runtimeOnly: true
        });
        assert.deepEqual(graph.blockers, []);
        assert(
          graph.files.some((f) => f.path === setup.mount + '/' + setup.entry),
          'Transferred implementation is not connected'
        );
      }
      report = await verify(run, { allowExecution: true, timeoutMs: 120000 });
      await saveJson(path.join(folder, `verification-${n}.json`), report);
      attempt.status = report.status;
      if (report.status === 'verified-for-contract') {
        record.patch = await exportPatch(run);
        record.status = report.status;
        break;
      }
      error = {
        message:
          'Fix the implementation failures. Frozen contract, tests, source feature and capture are immutable.'
      };
    } catch (e) {
      attempt.error = e.message;
      error = { message: e.message };
    }
    console.log(arm, n, JSON.stringify(attempt));
  }
  record.status ??= 'attempts-exhausted';
  await saveJson(path.join(root, 'results.json'), results);
  await saveJson(path.join(base, 'paired-latest.json'), { root, setup: setup.root, results });
  console.log(arm, 'DONE', record.status);
}
assert(results.every((r) => r.status === 'verified-for-contract'));
console.log('PAIRED', root);
