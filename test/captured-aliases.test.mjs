import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { copyViteDependencies } from './helpers/vite-dependencies.mjs';
import path from 'node:path';
import os from 'node:os';
import { executeCommand, analyze, prepare, adapt, verify, exportPatch } from '../src/index.mjs';
import { loadAliases, aliasTarget } from '../src/providers/javascript/aliases.mjs';
import { inventory, saveJson, readJson, hash } from '../src/platform/files.mjs';
import { fixture } from '../scripts/fixture.mjs';

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-capture-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  await saveJson(path.join(source, 'package.json'), { type: 'module' });
  await copyViteDependencies(path.join(source, 'node_modules'));
  return { root, source, out: path.join(root, 'captured') };
}
async function capture(o) {
  return executeCommand(
    'capture-aliases',
    { source: o.source, out: o.out, allowExecution: true },
    { allowExecution: true }
  );
}

test('real Vite captures async config, regex aliases, plugin config and importer-specific buildStart resolutions', async (t) => {
  const o = await setup(t);
  await fs.rm(path.join(o.source, 'node_modules/vite'), { recursive: true });
  await fs.symlink('vitest-modern/node_modules/vite', path.join(o.source, 'node_modules/vite'));
  await fs.writeFile(path.join(o.source, '.env'), 'PORTSMITH_SENTINEL=never-copy\n');
  process.env.PORTSMITH_SENTINEL = 'never-inherit';
  t.after(() => delete process.env.PORTSMITH_SENTINEL);
  await fs.writeFile(
    path.join(o.source, 'vite.config.mjs'),
    `import path from 'node:path';
export default async ({command,mode})=>{
 if(command!=='build'||mode!=='production'||process.env.PORTSMITH_SENTINEL)throw Error('wrong execution context');
 let ready=false;
 return {plugins:[{name:'generated',config(){return {resolve:{alias:[{find:new RegExp('^@regex/(.*)$'),replacement:path.resolve('src')+'/$1'}]}}},buildStart(){ready=true;},resolveId(id,from){if(id==='@selected'){if(!ready)throw Error('not ready');return path.resolve(from.endsWith('a.mjs')?'src/one.mjs':'src/two.mjs');}if(id==='virtual:data')return '\\0data';}}]};};`
  );
  await fs.mkdir(path.join(o.source, 'src'));
  for (const [file, text] of Object.entries({
    'one.mjs': 'export const value=1;',
    'two.mjs': 'export const value=2;',
    'a.mjs': "export {value} from '@selected';",
    'b.mjs': "export {value} from '@selected';",
    'regex.mjs': "export {value} from '@regex/one.mjs';",
    'virtual.mjs': "import 'virtual:data';"
  }))
    await fs.writeFile(path.join(o.source, 'src', file), text);
  const before = await inventory(o.source),
    result = await capture(o);
  assert.equal(result.status, 'captured');
  assert.deepEqual(await inventory(o.source), before);
  await assert.rejects(fs.access(path.join(o.out, '.env')));
  const aliases = await loadAliases(o.out);
  assert.equal(aliasTarget('@selected', aliases, 'src/a.mjs'), 'src/one.mjs');
  assert.equal(aliasTarget('@selected', aliases, 'src/b.mjs'), 'src/two.mjs');
  assert.equal(aliasTarget('@regex/one.mjs', aliases, 'src/regex.mjs'), 'src/one.mjs');
  assert.throws(() => aliasTarget('@selected', aliases, 'new.mjs'), /Uncaptured/);
  assert.throws(() => aliasTarget('virtual:data', aliases, 'src/virtual.mjs'), /unsupported/);
  assert.equal((await analyze({ source: o.out, entry: 'src/a.mjs', aliases: true })).blockers.length, 0);
  assert(
    (await analyze({ source: o.out, entry: 'src/virtual.mjs', aliases: true })).blockers.some((x) =>
      x.includes('unsupported')
    )
  );
  await fs.appendFile(path.join(o.out, 'vite.config.mjs'), '\n// drift');
  await assert.rejects(loadAliases(o.out), /changed/);
});

test('capture authorization, timeout and repository writes fail without publishing or changing originals', async (t) => {
  const o = await setup(t);
  await assert.rejects(executeCommand('capture-aliases', { source: o.source, out: o.out }), /authorization/);
  await fs.writeFile(
    path.join(o.source, 'vite.config.mjs'),
    "import fs from 'node:fs'; fs.writeFileSync('changed.txt','bad');export default {};"
  );
  await assert.rejects(capture(o), /changed repository/);
  await assert.rejects(fs.access(o.out));
  await assert.rejects(fs.access(path.join(o.source, 'changed.txt')));
  await fs.writeFile(
    path.join(o.source, 'vite.config.mjs'),
    'export default async()=>{await new Promise(r=>setTimeout(r,10000));return {};};'
  );
  await assert.rejects(
    executeCommand(
      'capture-aliases',
      { source: o.source, out: o.out, allowExecution: true, timeoutMs: 100 },
      { allowExecution: true }
    ),
    /timeout/
  );
  await assert.rejects(fs.access(o.out));
});

test('captured source aliases survive extraction, callable execution, build checks and patch export', async (t) => {
  const o = await setup(t);
  await fs.rm(o.source, { recursive: true });
  const f = await fixture(o.root);
  await copyViteDependencies(path.join(f.source, 'node_modules'));
  const entry = path.join(f.source, f.entry),
    text = await fs.readFile(entry, 'utf8');
  await fs.writeFile(entry, text.replace('./normalize.mjs', '@generated'));
  await fs.writeFile(
    path.join(f.source, 'vite.config.mjs'),
    "import path from 'node:path';export default async()=>({plugins:[{name:'runtime-alias',resolveId(id){if(id==='@generated')return path.resolve('src/normalize.mjs')}}]});"
  );
  await capture(o);
  f.source = o.out;
  const contract = await readJson(f.contract);
  contract.runtime = { aliases: true };
  await saveJson(f.contract, contract);
  await assert.rejects(prepare(f), /production build check/);
  // Real Vite production build of the transferred application entry, from both baseline and candidate.
  await fs.writeFile(
    path.join(f.target, 'vite.config.mjs'),
    "import path from 'node:path';export default async()=>({plugins:[{name:'target-alias',resolveId(id){if(id==='@catalog')return path.resolve('src/catalog-impl.mjs')}}],build:{lib:{entry:'src/catalog.mjs',formats:['es']},minify:false}});"
  );
  contract.checks = [
    { name: 'production-build', command: process.execPath, args: ['node_modules/vite/bin/vite.js', 'build'] }
  ];
  await saveJson(f.contract, contract);
  await fs.rename(path.join(f.target, 'src/catalog.mjs'), path.join(f.target, 'src/catalog-impl.mjs'));
  await fs.writeFile(
    path.join(f.target, 'src/catalog.mjs'),
    "export {searchCatalog,getProduct} from '@catalog';"
  );
  const proposal = await readJson(path.join(o.root, 'proposal.json'));
  proposal.edits[0].path = 'src/catalog-impl.mjs';
  await saveJson(path.join(o.root, 'proposal.json'), proposal);
  await copyViteDependencies(path.join(f.target, 'node_modules'));
  const capturedTarget = path.join(o.root, 'captured-target');
  await capture({ source: f.target, out: capturedTarget });
  f.target = capturedTarget;
  await prepare(f);
  for (const side of ['source', 'baseline', 'candidate'])
    await copyViteDependencies(path.join(f.out, side, 'node_modules'));
  await adapt(f.out, path.join(o.root, 'proposal.json'));
  const result = await verify(f.out, { allowExecution: true, timeoutMs: 30000 });
  assert.equal(result.status, 'verified-for-contract', JSON.stringify(result));
  assert.equal(result.version, 9);
  await exportPatch(f.out);
  const receipt = 'portsmith.resolved-aliases.json',
    file = path.join(f.out, 'candidate', receipt),
    bytes = await fs.readFile(file);
  await saveJson(path.join(o.root, 'bad-proposal.json'), {
    edits: [{ path: receipt, beforeSha256: hash(bytes), content: '{}' }]
  });
  await assert.rejects(adapt(f.out, path.join(o.root, 'bad-proposal.json')), /Cannot edit/);
  await fs.writeFile(file, '{}');
  await assert.rejects(exportPatch(f.out), /unchanged/);
});

test('prefixed upstream license notices are retained in the transfer', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-license-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const f = await fixture(root);
  const content = 'Upstream MIT license notice';
  await fs.writeFile(path.join(f.source, 'MIT-LICENSE.txt'), content);
  const graph = await analyze(f);
  assert(graph.license.files.some((file) => file.path === 'MIT-LICENSE.txt'));
  await prepare(f);
  assert.equal(await fs.readFile(path.join(f.out, 'candidate', f.mount, 'MIT-LICENSE.txt'), 'utf8'), content);
});

test('planned workspace package imports use the owning manifest rather than requiring a root declaration', async (t) => {
  const o = await setup(t);
  await saveJson(path.join(o.source, 'package.json'), { type: 'module', workspaces: ['packages/*'] });
  await fs.mkdir(path.join(o.source, 'packages/app'), { recursive: true });
  await saveJson(path.join(o.source, 'packages/app/package.json'), {
    name: 'app',
    version: '1.0.0',
    type: 'module',
    dependencies: { yaml: '2.8.1' }
  });
  await fs.writeFile(path.join(o.source, 'vite.config.mjs'), 'export default {};');
  const imports = path.join(o.root, 'imports.json');
  await saveJson(imports, [{ importer: 'packages/app/new.mjs', specifier: 'yaml' }]);
  const result = await executeCommand(
    'capture-aliases',
    { source: o.source, out: o.out, imports, allowExecution: true },
    { allowExecution: true }
  );
  assert.equal(result.plannedImports, 1);
  assert.equal(aliasTarget('yaml', await loadAliases(o.out), 'packages/app/new.mjs'), null);
});
