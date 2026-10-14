import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { readJson, saveJson, inventory, same, hash, json } from '../src/platform/files.mjs';
const base = path.resolve('.portsmith/search-bench');
const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : (await readJson(path.join(base, 'paired-latest.json'))).root;
const results = await readJson(path.join(root, 'results.json'));
for (const record of results) {
  assert.equal(record.status, 'verified-for-contract');
  const folder = await fs.mkdtemp(path.join(base, `proof-${record.arm}-`));
  const before = await inventory(path.join(record.run, 'candidate'));
  const proof = { arm: record.arm, run: record.run, folder, steps: [], status: 'running' };
  for (const [name, args] of [
    ['replay', ['scripts/replay-complex.mjs', '--case', 'drawdb', '--run', record.run, '--output', folder]],
    ['holdouts', ['scripts/holdout-search.mjs', record.run, path.join(folder, 'holdouts')]],
    ['browser', ['scripts/browser-search.mjs', record.run, path.join(folder, 'browser')]]
  ]) {
    const priorBrowser = path.join(root, 'proof', record.arm, 'browser-v2');
    if (name === 'browser') {
      let reusable = false;
      try {
        reusable =
          (await readJson(path.join(priorBrowser, 'baseline.json'))).status === 'passed' &&
          (await readJson(path.join(priorBrowser, 'candidate.json'))).status === 'passed' &&
          hash(json(before)) === record.finalCandidateInventorySha256;
      } catch {}
      if (reusable) {
        proof.browser = priorBrowser;
        proof.steps.push({ name, exitCode: 0, reused: true });
        continue;
      }
      proof.browser = path.join(folder, 'browser');
    }
    const log = await fs.open(path.join(folder, name + '.log'), 'wx');
    try {
      const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, {
          stdio: ['ignore', log.fd, log.fd],
          env: { PATH: process.env.PATH, LANG: 'C.UTF-8' }
        });
        child.on('error', reject);
        child.on('exit', resolve);
      });
      proof.steps.push({ name, exitCode: code });
      if (code !== 0) {
        proof.status = 'failed';
        await saveJson(path.join(folder, 'proof.json'), proof);
        throw Error(name + ' failed: ' + folder);
      }
    } finally {
      await log.close();
    }
  }
  assert(same(before, await inventory(path.join(record.run, 'candidate'))));
  proof.status = 'passed';
  proof.candidateUnchanged = true;
  await saveJson(path.join(folder, 'proof.json'), proof);
  await saveJson(path.join(root, record.arm + '-proof.json'), proof);
  console.log(record.arm, 'passed', folder);
}
