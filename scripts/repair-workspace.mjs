// Follow-up repair phase: same frozen runs, stronger destination-wrapper guidance, same common judge.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { adapt, verify, exportPatch } from '../src/index.mjs';
import { loadRun, protectedFile } from '../src/application/transfer.mjs';
import { modelContext, assertAutonomousProposal } from '../src/application/autonomous.mjs';
import { modelConfig, propose } from '../src/providers/model/client.mjs';
import { analyze } from '../src/providers/javascript/analyze.mjs';
import { regressionFiles } from '../src/providers/node/regression.mjs';
import { readJson, saveJson, inventory, hash, json } from '../src/platform/files.mjs';
const paired = path.resolve(process.argv[2]),
  arm = process.argv[3];
assert(['portsmith', 'rea'].includes(arm));
const previous = (await readJson(path.join(paired, 'results.json'))).find((r) => r.arm === arm);
assert(['attempts-exhausted', 'verified-for-contract'].includes(previous.status));
const setup = await readJson('.portsmith/workspace-bench/setup-latest.json');
const config = modelConfig(await readJson(setup.config));
const folder = await fs.mkdtemp(path.join(paired, 'repair-' + arm + '-')),
  run = previous.run,
  context = await loadRun(run);
const priorContext = await readJson(
  path.join(paired, previous.name + '-' + arm, 'attempt-' + previous.attempts.length + '-context.json')
);
const record = {
  arm,
  run,
  phase: 'follow-up repair with explicit destination-wrapper guidance',
  previousAttempts: previous.attempts.length,
  maxAdditionalAttempts: 3,
  attempts: [],
  status: 'running',
  engineInventory: await inventory(path.resolve('src'))
};
await saveJson(path.join(folder, 'result.json'), record);
await fs.copyFile(path.join(run, 'verification.json'), path.join(folder, 'before-verification.json'));
try {
  await fs.copyFile(path.join(run, 'transfer.patch'), path.join(folder, 'before-transfer.patch'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
console.log('REPAIR', arm, folder);
let report = await readJson(path.join(run, 'verification.json')),
  error = {
    message:
      'The initial trial needs a quality repair; retain its original result. Remove any type-error suppression. Adding any file within the copied featureMount, including a declaration, is forbidden. Resolve missing JavaScript types using a destination runtime wrapper and matching declaration outside the copied feature directory. Preserve all tests and config.'
  };
for (let n = 1; n <= 3; n++) {
  const attempt = { attempt: n };
  record.attempts.push(attempt);
  try {
    const input = await modelContext(context, report, error, config);
    input.integrationGoal = priorContext.integrationGoal;
    input.staticEvidence = priorContext.staticEvidence;
    assert(Buffer.byteLength(JSON.stringify(input)) <= config.maxContextBytes);
    await saveJson(path.join(folder, `attempt-${n}-context.json`), input);
    const generated = await propose(config, input);
    attempt.model = generated.model;
    attempt.usage = generated.usage;
    const file = path.join(folder, `attempt-${n}-proposal.json`);
    await saveJson(file, generated.proposal);
    for (const edit of generated.proposal.edits)
      assert(
        !(
          protectedFile(edit.path) ||
          regressionFiles(context.contract.regression).includes(edit.path) ||
          edit.path === context.state.analysis.mount ||
          edit.path.startsWith(context.state.analysis.mount + '/')
        ),
        'Protected file: ' + edit.path
      );
    await assertAutonomousProposal(context, generated.proposal);
    await adapt(run, file);
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
    assert.equal(report.integrity.status, 'passed');
  } catch (e) {
    attempt.status = 'rejected';
    attempt.error = e.message;
    error = { message: e.message };
  }
  await saveJson(path.join(folder, 'result.json'), record);
}
if (record.status === 'running') record.status = 'attempts-exhausted';
record.finalCandidateInventorySha256 = hash(json(await inventory(path.join(run, 'candidate'))));
await saveJson(path.join(folder, 'result.json'), record);
await saveJson(path.join(paired, 'repair-' + arm + '-latest.json'), { folder, ...record });
console.log('REPAIR END', arm, record.status, record.attempts.length);
assert.equal(record.status, 'verified-for-contract');
