import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { verify } from '../src/index.mjs';
import { inventory, copyInventory, readJson, saveJson, same, hash } from '../src/platform/files.mjs';
import { runProcess } from '../src/platform/process.mjs';
const { values } = parseArgs({
  options: { case: { type: 'string' }, run: { type: 'string' }, output: { type: 'string' } }
});
const name = values.case;
if (!['drawdb', 'mermaid-live-editor'].includes(name)) throw Error('--case drawdb|mermaid-live-editor');
const base = path.resolve('.portsmith/complex-bench');
const original = values.run
  ? path.resolve(values.run)
  : (await readJson(path.join(base, `${name}-latest.json`))).run;
const output = values.output ? path.resolve(values.output) : base;
await fs.mkdir(output, { recursive: true });
const evidence = await readJson(path.join(original, 'verification.json'));
assert.equal(evidence.status, 'verified-for-contract');
const root = await fs.mkdtemp(path.join(output, `${name}-replay-`));
for (const side of ['source', 'baseline', 'candidate']) {
  const from = path.join(original, side === 'candidate' ? 'baseline' : side),
    to = path.join(root, side);
  await fs.mkdir(to);
  await copyInventory(from, to, await inventory(from));
  if (side !== 'source')
    execFileSync('cp', ['-cR', path.join(original, side, 'node_modules'), path.join(to, 'node_modules')]);
}
// Reuse the real locked installations; this is a fresh patch replay, not another registry install.
for (const f of ['state.json', 'contract.json', 'dependencies.json'])
  await fs.copyFile(path.join(original, f), path.join(root, f));
const patch = path.join(original, 'transfer.patch');
for (const args of [
  ['-c', 'init.templateDir=', 'init', '--quiet'],
  ['apply', '--check', patch],
  ['apply', patch]
]) {
  const r = await runProcess('git', args, { cwd: path.join(root, 'candidate') });
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(r.reason, null);
}
assert.ok(
  same(await inventory(path.join(root, 'candidate')), await inventory(path.join(original, 'candidate')))
);
// Svelte's generated tsconfig is excluded execution metadata, regenerated in each fresh checkout.
if (name === 'mermaid-live-editor')
  for (const side of ['baseline', 'candidate']) {
    const r = await runProcess(process.execPath, ['node_modules/@sveltejs/kit/svelte-kit.js', 'sync'], {
      cwd: path.join(root, side),
      timeoutMs: 120000
    });
    assert.equal(r.exitCode, 0, r.stderr);
  }
const result = await verify(root, { allowExecution: true, timeoutMs: 120000 });
await saveJson(path.join(root, 'replay.json'), {
  original,
  patchSha256: hash(await fs.readFile(patch)),
  inventoryMatches: true,
  status: result.status
});
await saveJson(path.join(output, `${name}-replay-latest.json`), { root, original, status: result.status });
console.log(JSON.stringify({ root, status: result.status }));
assert.equal(result.status, 'verified-for-contract');
