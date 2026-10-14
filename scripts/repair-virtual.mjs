import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { readJson, saveJson, hash } from '../src/platform/files.mjs';
import { runProcess } from '../src/platform/process.mjs';
import { adapt, verify, exportPatch } from '../src/index.mjs';
import { loadRun } from '../src/application/transfer.mjs';
import { assertAutonomousProposal } from '../src/application/autonomous.mjs';
import { modelConfig, propose } from '../src/providers/model/client.mjs';
const paired = await readJson('.portsmith/virtual-bench/paired-latest.json'),
  setup = await readJson('.portsmith/virtual-bench/setup-latest.json');
const code = `import assert from 'node:assert/strict';import {stateHistory} from '../src/utils/deltaHistory.js';const failures=[];for(const [name,input] of [['empty',''],['whitespace','   '],['comment-only','# no snapshots\\n'],['malformed','broken: [']]){try{assert.throws(()=>stateHistory(input));}catch{failures.push(name)}}console.log(JSON.stringify({cases:4,failures,status:failures.length?'failed':'passed'}));if(failures.length)process.exitCode=1;`;
for (const item of paired.results) {
  const folder = path.dirname(item.run),
    candidate = path.join(item.run, 'candidate');
  await fs.mkdir(path.join(candidate, '.portsmith'), { recursive: true });
  await fs.writeFile(path.join(candidate, '.portsmith/negative.mjs'), code);
  const check = () =>
    runProcess(
      process.execPath,
      ['--import', path.resolve('src/providers/node/register-aliases.mjs'), '.portsmith/negative.mjs'],
      { cwd: candidate, timeoutMs: 30000 }
    );
  let result = await check();
  await saveJson(path.join(folder, 'negative-before.json'), result);
  console.log(item.arm, 'NEGATIVE', result.stdout);
  if (result.exitCode !== 0) {
    const file = setup.targetEntry,
      content = await fs.readFile(path.join(candidate, file), 'utf8');
    const input = {
      integrationGoal:
        'Reject empty YAML streams including comment-only documents (parseAllDocuments returns zero documents). Fix only the destination wrapper, preserving the transferred history/equality engine. Do not alter tests/config/source or add imports. Return a proposal with full file content.',
      failure: JSON.parse(result.stdout),
      files: [{ path: file, sha256: hash(content), content }]
    };
    await saveJson(path.join(folder, 'repair-context.json'), input);
    const generated = await propose(modelConfig(await readJson(setup.config)), input);
    const proposal = path.join(folder, 'proposal-2.json');
    await saveJson(proposal, generated.proposal);
    await assertAutonomousProposal(await loadRun(item.run), generated.proposal);
    await adapt(item.run, proposal);
    // Adapt replaces candidate inventories and intentionally excludes execution-only test metadata.
    await fs.mkdir(path.join(candidate, '.portsmith'), { recursive: true });
    await fs.writeFile(path.join(candidate, '.portsmith/negative.mjs'), code);
    result = await check();
    await saveJson(path.join(folder, 'negative-after.json'), result);
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const report = await verify(item.run, { allowExecution: true, timeoutMs: 120000 });
    await saveJson(path.join(folder, 'verification-2.json'), report);
    assert.equal(report.status, 'verified-for-contract');
    item.attempts.push({
      n: 2,
      reason: 'Supplemental comment-only stream exposed a missing empty-document guard',
      model: generated.model,
      usage: generated.usage,
      status: report.status
    });
    item.patch = await exportPatch(item.run);
  }
  item.negativeCases = JSON.parse(result.stdout);
  await saveJson(path.join(paired.root, 'results.json'), paired.results);
  await saveJson('.portsmith/virtual-bench/paired-latest.json', paired);
}
