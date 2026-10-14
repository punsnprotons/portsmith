// Replay a benchmark patch and rerun its unchanged verification contract.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { verify } from '../src/index.mjs';
import { copyInventory, inventory, readJson, saveJson, same, hash } from '../src/platform/files.mjs';
import { runProcess } from '../src/platform/process.mjs';
import { runBrowser } from '../src/providers/browser/client.mjs';
const { values } = parseArgs({ options: { case: { type: 'string' } } });
const name = values.case;
if (!['it-tools', 'todomvc-es6'].includes(name)) throw new Error('Select --case it-tools|todomvc-es6');
const base = path.resolve('.portsmith/github-bench');
const { run: original } = await readJson(path.join(base, `${name}-latest.json`));
const evidence = await readJson(path.join(original, 'verification.json'));
assert.equal(evidence.status, 'verified-for-contract');
const root = await fs.mkdtemp(path.join(base, `${name}-replay-`));
for (const side of ['source', 'baseline', 'candidate']) {
  const source = path.join(original, side === 'candidate' ? 'baseline' : side);
  await fs.mkdir(path.join(root, side));
  await copyInventory(source, path.join(root, side), await inventory(source));
  if (side !== 'source')
    await fs.symlink(path.join(original, side, 'node_modules'), path.join(root, side, 'node_modules'));
}
for (const file of ['state.json', 'contract.json'])
  await fs.copyFile(path.join(original, file), path.join(root, file));
const patch = path.join(original, 'transfer.patch');
for (const args of [
  ['-c', 'init.templateDir=', 'init', '--quiet'],
  ['apply', '--check', patch],
  ['apply', patch]
]) {
  const result = await runProcess('git', args, { cwd: path.join(root, 'candidate') });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.reason, null);
}
assert.ok(
  same(await inventory(path.join(root, 'candidate')), await inventory(path.join(original, 'candidate'))),
  'Replayed patch must exactly reproduce the verified inventory'
);
const result = await verify(root, { allowExecution: true, timeoutMs: 120000 });
await saveJson(path.join(root, 'replay.json'), {
  original,
  patchSha256: hash(await fs.readFile(patch)),
  inventoryMatches: true,
  status: result.status
});
assert.equal(
  result.status,
  'verified-for-contract',
  JSON.stringify({ integrity: result.integrity, checks: result.checks, browser: result.browser?.status })
);
// Check the built app separately using the same UI cases. This derived server
// configuration is supplemental evidence; it never replaces the frozen contract.
const contract = await readJson(path.join(root, 'contract.json'));
const production = path.join(root, 'production');
await fs.mkdir(production);
const browser = { ...contract.browser };
if (name === 'it-tools') {
  browser.server = {
    command: process.execPath,
    args: [
      'node_modules/vite/bin/vite.js',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      '{port}',
      '--strictPort'
    ]
  };
  await fs.symlink(path.join(root, 'candidate'), path.join(production, 'candidate'));
} else {
  delete browser.server;
  await fs.copyFile(
    path.join(root, 'candidate/test/public/learn.json'),
    path.join(root, 'candidate/dist/learn.json')
  );
  await fs.symlink(path.join(root, 'candidate/dist'), path.join(production, 'candidate'));
}
await saveJson(path.join(production, 'contract.json'), { ...contract, browser });
const artifacts = path.join(production, 'artifacts');
await fs.mkdir(artifacts);
const productionResult = await runBrowser(production, 'candidate', artifacts, 120000);
await saveJson(path.join(root, 'production-browser.json'), {
  originalContractSha256: evidence.contractSha256,
  ...productionResult
});
await saveJson(path.join(base, `${name}-replay-latest.json`), {
  root,
  original,
  status: result.status,
  productionBrowser: productionResult.status
});
console.log(
  JSON.stringify({ root, status: result.status, productionBrowser: productionResult.status }, null, 2)
);
assert.equal(productionResult.status, 'passed');
