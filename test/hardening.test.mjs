import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fixture } from '../scripts/fixture.mjs';
import { prepare, adapt, verify, exportPatch } from '../src/application/transfer.mjs';
import { analyze } from '../src/providers/javascript/analyze.mjs';
import { readJson, saveJson, hash, withRunLock } from '../src/platform/files.mjs';
import { runProcess } from '../src/platform/process.mjs';

async function setup(t, editBeforePrepare) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-hardening-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = await fixture(root);
  if (editBeforePrepare) await editBeforePrepare(options, root);
  await prepare(options);
  await adapt(options.out, path.join(root, 'proposal.json'));
  return { root, options, run: options.out, candidate: path.join(options.out, 'candidate') };
}

test('an exit-zero command that ran no tests cannot verify regressions', async (t) => {
  const { run } = await setup(t, async (o) => {
    const c = await readJson(o.contract);
    c.regression = { command: process.execPath, args: ['-e', 'process.exit(0)'] };
    await saveJson(o.contract, c);
  });
  assert.equal((await verify(run, { allowExecution: true })).status, 'failed');
});

for (const mode of ['empty', 'skipped', 'todo']) {
  test(`${mode} regression suites cannot be treated as passing tests`, async (t) => {
    const { run } = await setup(t, async (o) => {
      const source =
        mode === 'empty'
          ? '// no tests\n'
          : `import { test } from 'node:test';\ntest.${mode === 'skipped' ? 'skip' : 'todo'}('never tested', () => {});\n`;
      await fs.writeFile(path.join(o.target, 'test/catalog.test.mjs'), source);
    });
    assert.equal((await verify(run, { allowExecution: true })).status, 'failed');
  });
}

test('ignored files cannot leak into the exported patch', async (t) => {
  const { run, candidate } = await setup(t);
  await verify(run, { allowExecution: true });
  await fs.writeFile(path.join(candidate, '.env.local'), 'SECRET=should-never-be-in-a-patch');
  const result = await exportPatch(run);
  const patch = await fs.readFile(result.patch, 'utf8');
  assert.doesNotMatch(patch, /SECRET|\.env\.local/);
});

test('a symlink at the patch output cannot overwrite another file', async (t) => {
  const { run, root } = await setup(t);
  await verify(run, { allowExecution: true });
  const unrelated = path.join(root, 'keep.txt');
  await fs.writeFile(unrelated, 'keep');
  await fs.symlink(unrelated, path.join(run, 'transfer.patch'));
  await assert.rejects(exportPatch(run), /Symlink|symlink/);
  assert.equal(await fs.readFile(unrelated, 'utf8'), 'keep');
});

test('a valid patch larger than the subprocess log limit still exports', async (t) => {
  const { run, candidate } = await setup(t);
  await fs.writeFile(path.join(candidate, 'src/large.txt'), 'long patch line\n'.repeat(12000));
  assert.equal((await verify(run, { allowExecution: true })).status, 'verified-for-contract');
  const result = await exportPatch(run);
  assert.ok((await fs.stat(result.patch)).size > 128000);
});

test('bare Node built-ins are recognized rather than mistaken for npm dependencies', async (t) => {
  const { options } = await setup(t);
  await fs.appendFile(path.join(options.source, 'src/filter.mjs'), '\nimport { basename } from "path";\n');
  const result = await analyze(options);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.externals.find((e) => e.name === 'path')?.kind, 'node-builtin');
});

test('explicit regression files outside usual test directories cannot change', async (t) => {
  const { run, candidate } = await setup(t, async (o) => {
    await fs.writeFile(
      path.join(o.target, 'checks.mjs'),
      `import { test } from 'node:test';\ntest('check', () => {});\n`
    );
    const c = await readJson(o.contract);
    c.regression.args = ['--test', 'checks.mjs'];
    await saveJson(o.contract, c);
  });
  await fs.writeFile(
    path.join(candidate, 'checks.mjs'),
    `import { test } from 'node:test';\ntest('different test', () => {});\n`
  );
  await assert.rejects(verify(run, { allowExecution: true }), /test files must remain unchanged/);
});

test('a root file named __proto__ is included in the snapshot and patch', async (t) => {
  const { run, candidate } = await setup(t);
  await fs.writeFile(path.join(candidate, '__proto__'), 'tracked data\n');
  assert.equal((await verify(run, { allowExecution: true })).status, 'verified-for-contract');
  const result = await exportPatch(run);
  assert.match(await fs.readFile(result.patch, 'utf8'), /tracked data/);
  await fs.writeFile(path.join(candidate, '__proto__'), 'changed later\n');
  await assert.rejects(exportPatch(run), /stale/);
});

test('concurrent mutations of one run are rejected and the lock is released', async (t) => {
  const { run } = await setup(t);
  await withRunLock(run, async () => {
    await assert.rejects(verify(run, { allowExecution: true }), /busy/);
    await assert.rejects(exportPatch(run), /busy/);
  });
  assert.equal((await verify(run, { allowExecution: true })).status, 'verified-for-contract');
});

test('patch rewriting never rewrites file content that resembles a diff header', async (t) => {
  const { run, candidate, root, options } = await setup(t, async (o) => {
    await fs.writeFile(path.join(o.target, 'notes.txt'), '-- a/baseline/original\n');
  });
  await fs.writeFile(path.join(candidate, 'notes.txt'), '++ b/candidate/replacement\n');
  await fs.mkdir(path.join(candidate, 'src/a/baseline'), { recursive: true });
  await fs.writeFile(path.join(candidate, 'src/a/baseline/nested.txt'), 'preserve nested path\n');
  await verify(run, { allowExecution: true });
  const result = await exportPatch(run);
  const copy = path.join(root, 'apply');
  await fs.cp(options.target, copy, { recursive: true });
  const applied = await runProcess('git', ['apply', result.patch], { cwd: copy });
  assert.equal(applied.exitCode, 0, applied.stderr);
  assert.equal(await fs.readFile(path.join(copy, 'notes.txt'), 'utf8'), '++ b/candidate/replacement\n');
  assert.equal(
    await fs.readFile(path.join(copy, 'src/a/baseline/nested.txt'), 'utf8'),
    'preserve nested path\n'
  );
});

test('TypeScript feature transfer resolves and executes its imported helper', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-ts-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = await fixture(root);
  await fs.writeFile(
    path.join(options.source, 'src/normalize.ts'),
    `export const normalize = (value: string): string => value.trim().toLowerCase().normalize('NFD').replace(/\\p{Diacritic}/gu, '');\n`
  );
  await fs.writeFile(
    path.join(options.source, 'src/filter.ts'),
    `import { normalize } from './normalize.ts';\nexport function filterRows(rows: { id: number, name: string }[], query: string) { return rows.filter(row => normalize(row.name).includes(normalize(query))); }\n`
  );
  options.entry = 'src/filter.ts';
  const contract = await readJson(options.contract);
  contract.source.module = options.entry;
  await saveJson(options.contract, contract);
  const proposal = await readJson(path.join(root, 'proposal.json'));
  proposal.edits[0].content = proposal.edits[0].content.replace('src/filter.mjs', 'src/filter.ts');
  await saveJson(path.join(root, 'proposal.json'), proposal);
  await prepare(options);
  await adapt(options.out, path.join(root, 'proposal.json'));
  const report = await verify(options.out, { allowExecution: true });
  assert.equal(report.status, 'verified-for-contract', JSON.stringify(report));
  assert.equal((await exportPatch(options.out)).status, 'patch-ready');
});

test('binary and unicode-named files survive patch export and apply', async (t) => {
  const { root, options, run, candidate } = await setup(t);
  const bytes = Buffer.from([0, 255, 1, 128, 0, 254]);
  await fs.writeFile(path.join(candidate, 'src/café.bin'), bytes);
  await verify(run, { allowExecution: true });
  const result = await exportPatch(run);
  const dest = path.join(root, 'binary-copy');
  await fs.cp(options.target, dest, { recursive: true });
  const apply = await runProcess('git', ['apply', result.patch], { cwd: dest });
  assert.equal(apply.exitCode, 0, apply.stderr);
  assert.deepEqual(await fs.readFile(path.join(dest, 'src/café.bin')), bytes);
});

test('patch export rejects an exit-zero Git apply that silently skips all files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-skipped-patch-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = await fixture(root);
  await prepare(options);
  await adapt(options.out, path.join(root, 'proposal.json'));
  await verify(options.out, { allowExecution: true });
  const bin = path.join(root, 'bin');
  await fs.mkdir(bin);
  const previous = process.env.PATH;
  // Reproduce Git's real skip-with-exit-zero behavior while allowing diff/init.
  await fs.writeFile(
    path.join(bin, 'git'),
    `#!/usr/bin/env node\nimport {spawnSync} from 'node:child_process';\nconst args=process.argv.slice(2);if(args[0]==='apply')process.exit(0);const r=spawnSync('/usr/bin/git',args,{stdio:'inherit'});process.exit(r.status??1);`,
    { mode: 0o700 }
  );
  try {
    process.env.PATH = bin + path.delimiter + previous;
    await assert.rejects(exportPatch(options.out), /does not reproduce the verified candidate/);
  } finally {
    process.env.PATH = previous;
  }
});

test('adaptation cannot weaken test/build configuration or package scripts', async (t) => {
  const { run, root } = await setup(t);
  for (const name of [
    'tsconfig.app.json',
    'vite.config.ts',
    'vitest.workspace.ts',
    'webpack.dev.js',
    'package.json'
  ]) {
    const candidate = path.join(run, 'candidate', name);
    let previous = null;
    try {
      previous = hash(await fs.readFile(candidate));
    } catch {}
    const proposal = path.join(root, 'unsafe-config.json');
    await saveJson(proposal, { edits: [{ path: name, beforeSha256: previous, content: '{}' }] });
    await assert.rejects(adapt(run, proposal), /Cannot edit regression tests/);
  }
});
