import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { copyViteDependencies } from './helpers/vite-dependencies.mjs';
import { runProcess } from '../src/platform/process.mjs';
import { pathToFileURL } from 'node:url';
const copyDependencies = copyViteDependencies;
import { executeCommand, analyze } from '../src/index.mjs';
import { inventory, saveJson, readJson } from '../src/platform/files.mjs';
import { loadAliases, aliasTarget } from '../src/providers/javascript/aliases.mjs';

for (const modern of [false, true])
  test(`virtual ESM graph and planned package imports through Vite ${modern ? 8 : 4}`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-virtual-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const source = path.join(root, 'source'),
      out = path.join(root, 'captured');
    await fs.mkdir(source);
    await copyDependencies(path.join(source, 'node_modules'));
    if (modern) {
      await fs.rm(path.join(source, 'node_modules/vite'), { recursive: true });
      await fs.symlink('vitest-modern/node_modules/vite', path.join(source, 'node_modules/vite'));
    }
    await saveJson(path.join(source, 'package.json'), { type: 'module', dependencies: { yaml: '2.8.1' } });
    await fs.writeFile(path.join(source, 'entry.mjs'), "export {value} from 'virtual:outer';");
    await fs.writeFile(path.join(source, 'local.mjs'), 'export const local=3;');
    await fs.writeFile(
      path.join(source, 'vite.config.mjs'),
      `import path from 'node:path';export default {plugins:[{name:'virtual-test',resolveId(id,from){if(id==='./local.mjs'&&from?.startsWith('\\0'))return path.resolve('local.mjs');if(id.startsWith('virtual:'))return '\\0'+id;},load(id){if(id==='\\0virtual:outer')return "import {inner} from 'virtual:inner';import {local} from './local.mjs';export const value=inner+local;";if(id==='\\0virtual:inner')return "import {parse} from 'yaml';export const inner=parse('TRANSFORM_ME');";},transform(code,id){if(id==='\\0virtual:inner')return code.replace('TRANSFORM_ME','4');}}]};`
    );
    const imports = path.join(root, 'imports.json');
    await saveJson(imports, [{ importer: 'new-wrapper.mjs', specifier: 'yaml' }]);
    const before = await inventory(source);
    const command = await runProcess(
      process.execPath,
      [
        path.resolve('src/cli.mjs'),
        'capture-aliases',
        '--source',
        source,
        '--out',
        out,
        '--imports',
        imports,
        '--virtual-modules',
        '--allow-execution',
        '--json'
      ],
      { timeoutMs: 120000 }
    );
    assert.equal(command.exitCode, 0, command.stderr);
    assert.equal(command.reason, null);
    const result = JSON.parse(command.stdout);
    assert.equal(result.virtualModules, 2);
    assert.equal(result.plannedImports, 1);
    assert.deepEqual(await inventory(source), before);
    const aliases = await loadAliases(out);
    assert.equal(aliasTarget('yaml', aliases, 'new-wrapper.mjs'), null);
    assert.throws(() => aliasTarget('yaml', aliases, 'unplanned.mjs'), /Uncaptured/);
    const graph = await analyze({ source: out, entry: 'entry.mjs', aliases: true });
    assert.deepEqual(graph.blockers, []);
    assert.equal(graph.files.length, 4);
    const receipt = await readJson(result.receipt);
    const generated = receipt.generated.find(
      (m) => !m.content && m.path === aliasTarget('virtual:outer', aliases, 'entry.mjs')
    );
    const { value } = await import(pathToFileURL(path.join(out, generated.path)));
    assert.equal(value, 7);
    await fs.appendFile(path.join(out, generated.path), '\n// tamper');
    await assert.rejects(loadAliases(out), /virtual module changed/);
  });

test('virtual graph cycles preserve identity and unsafe generated imports fail closed', async () => {
  const { virtualModules } = await import('../src/providers/vite/virtual-modules.mjs');
  const modules = new Map([
    ['\0a', "import {b} from 'virtual:b';export const a=()=>b;"],
    ['\0b', "import {a} from 'virtual:a';export const b=()=>a;"]
  ]);
  const ctx = {
    load: async ({ id }) => ({ code: modules.get(id) }),
    resolve: async (spec) => ({ id: '\0' + spec.split(':')[1] })
  };
  const graph = virtualModules('/repo', {}, new Map());
  assert.equal(await graph.materialize(ctx, '\0a'), await graph.materialize(ctx, '\0a'));
  assert.equal(graph.entries().length, 2);
  assert(graph.entries().every((m) => m.sha256 && !m.content.includes('virtual:')));
  for (const code of [
    'export const x=import.meta.url;',
    'export const x=import(name);',
    "const x=require('x');",
    "import x from './style.css';export {x};"
  ]) {
    const g = virtualModules('/repo', {}, new Map());
    await assert.rejects(
      g.materialize(
        { load: async () => ({ code }), resolve: async () => ({ id: '/repo/style.css' }) },
        '\0bad'
      ),
      /portable|Computed|CommonJS|snapshot code/
    );
  }
});

test('generated modules plus newly planned package import transfer, verify, export and reject older proof', async (t) => {
  const { fixture } = await import('../scripts/fixture.mjs');
  const { prepare, adapt, verify, exportPatch } = await import('../src/index.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-virtual-transfer-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const f = await fixture(root);
  for (const dir of [f.source, f.target]) await copyDependencies(path.join(dir, 'node_modules'));
  const normalize = await fs.readFile(path.join(f.source, 'src/normalize.mjs'), 'utf8');
  await fs.writeFile(
    path.join(f.source, f.entry),
    (await fs.readFile(path.join(f.source, f.entry), 'utf8')).replace('./normalize.mjs', 'virtual:normalize')
  );
  await fs.writeFile(
    path.join(f.source, 'vite.config.mjs'),
    `export default {plugins:[{name:'normalize',resolveId(id){if(id==='virtual:normalize')return '\\0normalize';},load(id){if(id==='\\0normalize')return ${JSON.stringify(normalize)};}}]};`
  );
  await fs.writeFile(
    path.join(f.target, 'vite.config.mjs'),
    "export default {build:{lib:{entry:'src/catalog.mjs',formats:['es']}}};"
  );
  const pkg = await readJson(path.join(f.target, 'package.json'));
  pkg.dependencies = { yaml: '2.8.1' };
  await saveJson(path.join(f.target, 'package.json'), pkg);
  const imports = path.join(root, 'imports.json');
  await saveJson(imports, [{ importer: 'src/catalog.mjs', specifier: 'yaml' }]);
  const capture = async (source, out, extra) =>
    executeCommand(
      'capture-aliases',
      { source, out, ...extra, allowExecution: true },
      { allowExecution: true }
    );
  await capture(f.source, path.join(root, 'captured-source'), { virtualModules: true });
  await capture(f.target, path.join(root, 'captured-target'), { imports });
  f.source = path.join(root, 'captured-source');
  f.target = path.join(root, 'captured-target');
  const contract = await readJson(f.contract);
  contract.runtime = { aliases: true };
  contract.checks = [
    { name: 'production', command: process.execPath, args: ['node_modules/vite/bin/vite.js', 'build'] }
  ];
  await saveJson(f.contract, contract);
  await assert.rejects(prepare(f), /capturedImports/);
  contract.runtime.capturedImports = true;
  await saveJson(f.contract, contract);
  await prepare(f);
  for (const side of ['source', 'baseline', 'candidate'])
    await copyDependencies(path.join(f.out, side, 'node_modules'));
  const proposal = await readJson(path.join(root, 'proposal.json'));
  proposal.edits[0].content =
    "import {parse,stringify} from 'yaml';\n" +
    proposal.edits[0].content.replace(
      'filterRows(products, query)',
      'filterRows(parse(stringify(products)), query)'
    );
  await saveJson(path.join(root, 'proposal.json'), proposal);
  await adapt(f.out, path.join(root, 'proposal.json'));
  const result = await verify(f.out, { allowExecution: true, timeoutMs: 30000 });
  assert.equal(result.status, 'verified-for-contract', JSON.stringify(result));
  assert.equal(result.version, 10);
  await exportPatch(f.out);
  const file = path.join(f.out, 'verification.json');
  const proof = await readJson(file);
  proof.version = 9;
  await saveJson(file, proof);
  await assert.rejects(exportPatch(f.out), /Verification|verification|verified/);
});

test('planned packages must be declared and resolvable; invalid plans never execute', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-planned-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'),
    imports = path.join(root, 'imports.json'),
    out = path.join(root, 'out');
  await fs.mkdir(source);
  await saveJson(path.join(source, 'package.json'), { type: 'module' });
  const capture = () =>
    executeCommand(
      'capture-aliases',
      { source, out, imports, allowExecution: true },
      { allowExecution: true }
    );
  for (const plan of [
    [null],
    [{ importer: '../escape.mjs', specifier: 'yaml' }],
    [{ importer: 'new.mjs', specifier: 'yaml/../x' }]
  ]) {
    await saveJson(imports, plan);
    await assert.rejects(capture(), /Invalid|Unsafe|literal/);
    await assert.rejects(fs.access(out));
  }
  await copyDependencies(path.join(source, 'node_modules'));
  await saveJson(imports, [{ importer: 'new.mjs', specifier: 'yaml' }]);
  await assert.rejects(capture(), /undeclared/);
  await saveJson(imports, [{ importer: 'new.mjs', specifier: 'portsmith-definitely-not-installed' }]);
  await assert.rejects(capture(), /did not resolve/);
  await assert.rejects(fs.access(out));
});
