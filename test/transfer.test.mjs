import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fixture } from '../scripts/fixture.mjs';
import { analyze } from '../src/providers/javascript/analyze.mjs';
import { prepare, adapt, verify, exportPatch, status } from '../src/application/transfer.mjs';
import { hash, inventory, readJson, saveJson } from '../src/platform/files.mjs';
import { runProcess } from '../src/platform/process.mjs';

async function setup(t, { prepared = true, adapted = false, contractEdit } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = await fixture(root);
  if (contractEdit) {
    const contract = await readJson(options.contract);
    contractEdit(contract);
    await saveJson(options.contract, contract);
  }
  if (prepared) await prepare(options);
  if (adapted) await adapt(options.out, path.join(root, 'proposal.json'));
  return { root, options, run: options.out, candidate: path.join(options.out, 'candidate') };
}

test('real transfer: source behavior, destination improvement, regressions and applyable patch', async (t) => {
  const { root, options, run } = await setup(t, { adapted: true });
  const before = await inventory(options.target);
  const report = await verify(run, { allowExecution: true });
  assert.equal(report.status, 'verified-for-contract');
  assert.equal(report.source.cases.filter((c) => c.status === 'passed').length, 5);
  assert.equal(report.baseline.cases.filter((c) => c.status === 'mismatch').length, 4);
  assert.equal(report.candidate.cases.filter((c) => c.status === 'passed').length, 5);
  assert.equal(report.regression.candidate.status, 'passed');
  assert.deepEqual(await inventory(options.target), before);
  const patch = await exportPatch(run);
  const applied = path.join(root, 'applied');
  await fs.cp(options.target, applied, { recursive: true });
  const result = await runProcess('git', ['apply', patch.patch], { cwd: applied });
  assert.equal(result.exitCode, 0, result.stderr);
  const { searchCatalog } = await import(path.join(applied, 'src/catalog.mjs'));
  assert.deepEqual(searchCatalog('CAFE'), [{ id: 1, name: 'Café beans' }]);
  assert.deepEqual(
    await fs.readFile(path.join(applied, 'src/features/table-filter/LICENSE')),
    await fs.readFile(path.join(options.source, 'LICENSE'))
  );
  assert.equal((await status(run)).verification.stale, false);
});

test('copying the feature without integration does not pass', async (t) => {
  const { run } = await setup(t);
  assert.equal((await verify(run, { allowExecution: true })).status, 'failed');
  await assert.rejects(exportPatch(run), /passing contract/);
});

test('execution requires explicit authorization', async (t) => {
  const { run } = await setup(t);
  await assert.rejects(verify(run), /allow-execution/);
  await assert.rejects(fs.stat(path.join(run, 'verification.json')), { code: 'ENOENT' });
});

test('a candidate edit makes a previously verified patch stale', async (t) => {
  const { run, candidate } = await setup(t, { adapted: true });
  await verify(run, { allowExecution: true });
  await fs.appendFile(path.join(candidate, 'src/catalog.mjs'), '\n// changed\n');
  assert.equal((await status(run)).verification.stale, true);
  await assert.rejects(exportPatch(run), /stale/);
});

test('changing the original destination invalidates verification', async (t) => {
  const { run, options } = await setup(t, { adapted: true });
  await fs.appendFile(path.join(options.target, 'src/catalog.mjs'), '\n// user edit\n');
  await assert.rejects(verify(run, { allowExecution: true }), /Original destination changed/);
});

test('a changed contract cannot silently weaken verification', async (t) => {
  const { run } = await setup(t);
  const file = path.join(run, 'contract.json');
  const contract = await readJson(file);
  contract.cases.pop();
  await saveJson(file, contract);
  await assert.rejects(verify(run, { allowExecution: true }), /Frozen contract changed/);
});

test('directly changing destination tests blocks verification', async (t) => {
  const { run, candidate } = await setup(t, { adapted: true });
  await fs.writeFile(path.join(candidate, 'test/catalog.test.mjs'), '// emptied test');
  await assert.rejects(verify(run, { allowExecution: true }), /test files must remain unchanged/);
});

test('proposal rejects all edits if any hash is stale', async (t) => {
  const { run, root, candidate } = await setup(t);
  const before = await inventory(candidate);
  const proposal = await readJson(path.join(root, 'proposal.json'));
  proposal.edits.push({ path: 'src/new.mjs', beforeSha256: '0'.repeat(64), content: 'export const x = 1;' });
  await saveJson(path.join(root, 'bad.json'), proposal);
  await assert.rejects(adapt(run, path.join(root, 'bad.json')), /Stale edit/);
  assert.deepEqual(await inventory(candidate), before);
});

test('proposal rejects traversal and cannot edit test files', async (t) => {
  const { run, root } = await setup(t);
  for (const rel of ['../escape.mjs', 'src/../../escape', '/tmp/escape', 'test/catalog.test.mjs']) {
    await saveJson(path.join(root, 'bad.json'), { edits: [{ path: rel, beforeSha256: null, content: 'x' }] });
    await assert.rejects(adapt(run, path.join(root, 'bad.json')), /Unsafe|Cannot edit regression/);
  }
});

test('source execution errors do not count as behavior proof', async (t) => {
  const { run } = await setup(t, {
    adapted: true,
    contractEdit: (c) => {
      c.source.export = 'missing';
    }
  });
  const result = await verify(run, { allowExecution: true });
  assert.equal(result.source.status, 'error');
  assert.equal(result.status, 'failed');
});

test('a broken baseline is not evidence of a missing feature', async (t) => {
  const { options, root } = await setup(t, { prepared: false });
  const filename = path.join(options.target, 'src/catalog.mjs');
  const original = await fs.readFile(filename, 'utf8');
  const broken = original.replace(
    'return products.map(product => ({ ...product }));',
    'throw new Error("broken app");'
  );
  await fs.writeFile(filename, broken);
  await prepare(options);
  const proposal = await readJson(path.join(root, 'proposal.json'));
  proposal.edits[0].beforeSha256 = hash(broken);
  await saveJson(path.join(root, 'proposal.json'), proposal);
  await adapt(options.out, path.join(root, 'proposal.json'));
  const report = await verify(options.out, { allowExecution: true });
  assert.equal(report.candidate.status, 'passed');
  assert.equal(report.baselineDemonstratesGap, false);
  assert.equal(report.status, 'failed');
});

test('passing behavior with broken existing behavior fails regression gate', async (t) => {
  const { run, candidate } = await setup(t, { adapted: true });
  const file = path.join(candidate, 'src/catalog.mjs');
  await fs.writeFile(
    file,
    (await fs.readFile(file, 'utf8')).replace('return product ? { ...product } : null;', 'return null;')
  );
  const report = await verify(run, { allowExecution: true });
  assert.equal(report.candidate.status, 'passed');
  assert.equal(report.regression.candidate.status, 'failed');
  assert.equal(report.status, 'failed');
});

test('missing regressions stay explicitly unchecked and cannot export', async (t) => {
  const { run } = await setup(t, {
    adapted: true,
    contractEdit: (c) => {
      delete c.regression;
    }
  });
  const report = await verify(run, { allowExecution: true });
  assert.equal(report.status, 'behavior-verified-regressions-unchecked');
  await assert.rejects(exportPatch(run), /passing contract/);
});

test('mutations by test execution invalidate the result', async (t) => {
  const { run, candidate } = await setup(t, { adapted: true });
  await fs.appendFile(
    path.join(candidate, 'src/catalog.mjs'),
    `\nimport fs from 'node:fs';\nfs.writeFileSync('unexpected.txt', 'side effect');\n`
  );
  const report = await verify(run, { allowExecution: true });
  assert.equal(report.integrity.status, 'failed');
  assert.equal(report.status, 'failed');
});

test('hung code times out and is not verified', async () => {
  const result = await runProcess(process.execPath, ['-e', 'while(true) {}'], {
    cwd: os.tmpdir(),
    timeoutMs: 150
  });
  assert.equal(result.reason, 'timeout');
  assert.notEqual(result.exitCode, 0);
});

test('excessive output is bounded and execution fails', async () => {
  const result = await runProcess(
    process.execPath,
    ['-e', 'require("node:fs").writeSync(1, "x".repeat(1000000));'],
    { cwd: os.tmpdir(), timeoutMs: 5000 }
  );
  assert.equal(result.reason, 'output-limit');
  assert.ok(Buffer.byteLength(result.stdout) <= 128000);
});

test('prepare refuses run directories inside the source', async (t) => {
  const { options } = await setup(t, { prepared: false });
  await assert.rejects(prepare({ ...options, out: path.join(options.source, 'run') }), /outside both/);
});

test('dependency closure follows local imports and stops cycles', async (t) => {
  const { options } = await setup(t, { prepared: false });
  await fs.appendFile(path.join(options.source, 'src/normalize.mjs'), '\nimport "./filter.mjs";\n');
  const result = await analyze(options);
  assert.deepEqual(
    result.files.map((f) => f.path),
    ['src/filter.mjs', 'src/normalize.mjs']
  );
  assert.equal(result.edges.length, 2);
  assert.deepEqual(result.blockers, []);
});

test('computed imports, aliases and missing imports are explicit blockers', async (t) => {
  const { options } = await setup(t, { prepared: false });
  await fs.appendFile(
    path.join(options.source, 'src/filter.mjs'),
    '\nimport x from "@/missing";\nimport "./missing.mjs";\nconst x2 = () => import(variable);\n'
  );
  const result = await analyze(options);
  assert.ok(result.blockers.some((b) => b.includes('computed')));
  assert.ok(result.blockers.some((b) => b.includes('alias')));
  assert.ok(result.blockers.some((b) => b.includes('unresolved')));
  await assert.rejects(prepare(options), /Preparation blocked/);
});

test('conflicting dependency ranges block preparation', async (t) => {
  const { options } = await setup(t, { prepared: false });
  await fs.appendFile(path.join(options.source, 'src/filter.mjs'), '\nimport "example-dep";\n');
  await saveJson(path.join(options.source, 'package.json'), { dependencies: { 'example-dep': '^1.0.0' } });
  await saveJson(path.join(options.target, 'package.json'), { dependencies: { 'example-dep': '^2.0.0' } });
  const result = await analyze(options);
  assert.equal(result.externals[0].status, 'conflict');
  await assert.rejects(prepare(options), /conflict/);
});

test('symlinked files are not read into a transfer', async (t) => {
  const { options } = await setup(t, { prepared: false });
  const helper = path.join(options.source, 'src/normalize.mjs');
  await fs.rename(helper, path.join(options.source, 'real.mjs'));
  await fs.symlink('../real.mjs', helper);
  await assert.rejects(prepare(options), /Symlinks/);
});

test('environment files are excluded from copies', async (t) => {
  const { options } = await setup(t, { prepared: false });
  await fs.writeFile(path.join(options.target, '.env.local'), 'EXAMPLE_SECRET=not-a-real-secret');
  await prepare(options);
  await assert.rejects(fs.stat(path.join(options.out, 'candidate/.env.local')), { code: 'ENOENT' });
});

test('patch applies to added filenames containing spaces', async (t) => {
  const { root, run, candidate } = await setup(t, { adapted: true });
  await fs.writeFile(path.join(candidate, 'src/extra file.mjs'), 'export const value = 1;\n');
  await verify(run, { allowExecution: true });
  const result = await exportPatch(run);
  const dest = path.join(root, 'space-dest');
  await fs.cp(path.join(root, 'target'), dest, { recursive: true });
  const applied = await runProcess('git', ['apply', result.patch], { cwd: dest });
  assert.equal(applied.exitCode, 0, applied.stderr);
  assert.equal(await fs.readFile(path.join(dest, 'src/extra file.mjs'), 'utf8'), 'export const value = 1;\n');
});

test('JS features retain adjacent declarations and trace runtime imports instead of only d.ts files', async (t) => {
  const { options } = await setup(t, { prepared: false });
  await fs.writeFile(
    path.join(options.source, 'src/entry.js'),
    "import feature from './feature.js'; export default feature;\n"
  );
  await fs.writeFile(
    path.join(options.source, 'src/feature.js'),
    'export default function feature(x) { return x+1; }\n'
  );
  await fs.writeFile(
    path.join(options.source, 'src/feature.d.ts'),
    'export default function feature(x: number): number;\n'
  );
  const result = await analyze({ ...options, entry: 'src/entry.js' });
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(
    result.files.map((f) => f.path),
    ['src/entry.js', 'src/feature.d.ts', 'src/feature.js']
  );
  assert.equal(result.edges[0].to, 'src/feature.js');
  const contract = await readJson(options.contract);
  contract.source = { module: 'src/entry.js', export: 'default' };
  await saveJson(options.contract, contract);
  await prepare({ ...options, entry: 'src/entry.js' });
  assert.equal(
    await fs.readFile(path.join(options.out, 'candidate', options.mount, 'src/feature.d.ts'), 'utf8'),
    'export default function feature(x: number): number;\n'
  );
});

test('declared command checks are mandatory, versioned and retained in status/export evidence', async (t) => {
  const { run } = await setup(t, {
    adapted: true,
    contractEdit: (c) => {
      c.checks = [{ name: 'syntax', command: process.execPath, args: ['--check', 'src/catalog.mjs'] }];
    }
  });
  const report = await verify(run, { allowExecution: true });
  assert.equal(report.version, 4);
  assert.equal(report.status, 'verified-for-contract');
  assert.equal(report.checks.candidate[0].status, 'passed');
  assert.equal((await status(run)).verification.stale, false);
  await exportPatch(run);
  delete report.checks;
  await saveJson(path.join(run, 'verification.json'), report);
  await assert.rejects(exportPatch(run), /passing contract/);
  report.version = 3;
  await saveJson(path.join(run, 'verification.json'), report);
  assert.equal((await status(run)).verification.stale, true);
});

for (const mode of ['failure', 'timeout', 'no-regressions'])
  test(`additional checks cannot authorize export with ${mode}`, async (t) => {
    const { run } = await setup(t, {
      adapted: true,
      contractEdit: (c) => {
        c.checks = [
          {
            name: 'declared check',
            command: process.execPath,
            args: [
              '-e',
              mode === 'timeout'
                ? 'setInterval(()=>{},1000)'
                : mode === 'failure'
                  ? 'process.exit(1)'
                  : 'process.exit(0)'
            ]
          }
        ];
        if (mode === 'no-regressions') delete c.regression;
      }
    });
    const report = await verify(run, { allowExecution: true, timeoutMs: mode === 'timeout' ? 500 : 10000 });
    assert.notEqual(report.status, 'verified-for-contract');
    if (mode === 'timeout') assert.equal(report.checks.candidate[0].execution.reason, 'timeout');
    await assert.rejects(exportPatch(run), /passing contract/);
  });

test('opt-in relative runtime is frozen, versioned and cannot export older evidence', async (t) => {
  const { run } = await setup(t, {
    adapted: true,
    contractEdit: (c) => {
      c.runtime = { relativeImports: true };
    }
  });
  const report = await verify(run, { allowExecution: true });
  assert.equal(report.status, 'verified-for-contract');
  assert.equal(report.version, 5);
  await exportPatch(run);
  report.version = 4;
  await saveJson(path.join(run, 'verification.json'), report);
  assert.equal((await status(run)).verification.stale, true);
  await assert.rejects(exportPatch(run), /passing contract/);
});

test('transfers preserve root and nested module formats without copying package scripts', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-scopes-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = await fixture(root);
  await fs.writeFile(
    path.join(options.source, 'package.json'),
    JSON.stringify({ type: 'commonjs', scripts: { postinstall: 'untrusted script' } })
  );
  await fs.mkdir(path.join(options.source, 'nested'));
  await fs.writeFile(
    path.join(options.source, 'nested/package.json'),
    '{"type":"commonjs","dependencies":{"unused":"*"}}'
  );
  await fs.writeFile(path.join(options.source, 'nested/helper.js'), 'module.exports=x=>x+1;');
  await fs.writeFile(path.join(options.source, 'index.js'), "module.exports=require('./nested/helper.js');");
  await fs.writeFile(path.join(options.target, 'package.json'), '{"type":"module"}');
  const contract = await readJson(options.contract);
  contract.source = { module: 'index.js', export: 'default' };
  contract.cases = [{ name: 'CJS value', sourceArgs: [2], targetArgs: [], expected: 3 }];
  await saveJson(options.contract, contract);
  await prepare({ ...options, entry: 'index.js' });
  const mount = path.join(options.out, 'candidate', options.mount);
  assert.deepEqual(await readJson(path.join(mount, 'package.json')), { private: true, type: 'commonjs' });
  assert.deepEqual(await readJson(path.join(mount, 'nested/package.json')), {
    private: true,
    type: 'commonjs'
  });
  const result = await runProcess(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import fn from './${options.mount}/index.js'; if(fn(2)!==3)throw Error('wrong format');`
    ],
    { cwd: path.join(options.out, 'candidate') }
  );
  assert.equal(result.exitCode, 0, result.stderr);
  await fs.rm(path.join(mount, 'package.json'));
  await assert.rejects(verify(options.out, { allowExecution: true }), /must remain unchanged/);
});
