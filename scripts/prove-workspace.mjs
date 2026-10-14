import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readJson, saveJson } from '../src/platform/files.mjs';
const paired = await readJson('.portsmith/workspace-bench/paired-latest.json');
const proofRoot = await fs.mkdtemp(path.join(paired.root, 'proof-'));
async function command(script, args, log) {
  const output = await fs.open(log, 'w');
  try {
    await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [script, ...args], {
        stdio: ['ignore', output.fd, output.fd],
        env: { PATH: process.env.PATH }
      });
      p.on('error', reject);
      p.on('exit', (code) =>
        code === 0 ? resolve() : reject(Error(script + ' exited ' + code + '; see ' + log))
      );
    });
  } finally {
    await output.close();
  }
}
for (const initial of paired.results) {
  if (process.argv[2] && initial.arm !== process.argv[2]) continue;
  const repaired = await readJson(path.join(paired.root, 'repair-' + initial.arm + '-latest.json'));
  const item = { ...initial, ...repaired };
  assert.equal(item.status, 'verified-for-contract');
  const folder = path.join(proofRoot, item.arm);
  await fs.mkdir(folder, { recursive: true });
  await command(
    'scripts/holdout-workspace.mjs',
    [item.run, path.join(folder, 'holdouts')],
    path.join(folder, 'holdouts.log')
  );
  console.log(item.arm, 'holdouts passed');
  await command(
    'scripts/replay-index.mjs',
    ['--case', 'mermaid-live-editor', '--run', item.run, '--output', folder],
    path.join(folder, 'replay.log')
  );
  console.log(item.arm, 'replay passed');
  const replay = await readJson(path.join(folder, 'mermaid-live-editor-replay-latest.json'));
  await command(
    'scripts/browser-workspace.mjs',
    [replay.root, path.join(folder, 'browser')],
    path.join(folder, 'browser.log')
  );
  console.log(item.arm, 'browser passed');
  const proof = {
    status: 'passed',
    run: item.run,
    replay: replay.root,
    browser: path.join(folder, 'browser'),
    holdouts: path.join(folder, 'holdouts')
  };
  await saveJson(path.join(folder, 'proof.json'), proof);
  await saveJson(path.join(paired.root, 'proof-' + item.arm + '-latest.json'), { folder, ...proof });
}

await saveJson(path.join(paired.root, 'proof-latest.json'), { root: proofRoot });
