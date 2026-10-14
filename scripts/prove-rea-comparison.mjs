import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readJson, saveJson, inventory, hash, json } from '../src/platform/files.mjs';
const root = path.resolve(
    process.argv[2] ?? (await readJson('.portsmith/rea-comparison/paired-latest.json')).root
  ),
  filter = process.argv[3];
const arm = process.argv[4];
const results = await readJson(path.join(root, 'results.json'));
const evidence = [];
for (const r of results.filter((x) => (!filter || x.name === filter) && (!arm || x.arm === arm))) {
  assert.equal(r.status, 'verified-for-contract');
  const output = path.join(root, 'proof', r.name + '-' + r.arm);
  await fs.mkdir(output, { recursive: true });
  for (const [script, args] of [
    ['replay-complex.mjs', ['--output', output]],
    ['browser-complex.mjs', ['--output', output, '--network', 'online']],
    ['holdout-complex.mjs', ['--output', path.join(output, 'holdout.json')]]
  ]) {
    const run =
      script === 'replay-complex.mjs'
        ? r.run
        : (await readJson(path.join(output, r.name + '-replay-latest.json'))).root;
    console.log(r.name, r.arm, script);
    const log = execFileSync(
      process.execPath,
      [path.resolve('scripts', script), '--case', r.name, '--run', run, ...args],
      { encoding: 'utf8', maxBuffer: 4000000, timeout: 360000 }
    );
    await fs.writeFile(path.join(output, script + '.log'), log);
  }
  const replay = await readJson(path.join(output, r.name + '-replay-latest.json')),
    browser = await readJson(path.join(output, r.name + '-browser-latest.json')),
    holdout = await readJson(path.join(output, 'holdout.json'));
  assert.equal(browser.status, 'passed');
  assert.equal(holdout.status, 'passed');
  assert.equal(hash(json(await inventory(path.join(r.run, 'candidate')))), r.finalCandidateInventorySha256);
  const item = { name: r.name, arm: r.arm, replay, browser, holdout };
  evidence.push(item);
  await saveJson(path.join(output, 'proof.json'), item);
}
console.log('PROVED', evidence.map((r) => r.name + ':' + r.arm).join(', '));
