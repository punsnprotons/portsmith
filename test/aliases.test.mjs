import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fixture } from '../scripts/fixture.mjs';
import { executeCommand, prepare, adapt, verify, exportPatch, analyze } from '../src/index.mjs';
import { loadAliases, aliasTarget } from '../src/providers/javascript/aliases.mjs';
import { hash, readJson, saveJson } from '../src/platform/files.mjs';
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-alias-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test('alias configs support local JSONC inheritance and longest match without outside paths or ambiguous fallback', async (t) => {
  const root = await directory(t);
  await fs.writeFile(
    path.join(root, 'base.json'),
    '// local config\n{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"],"@/exact":["special.mjs"]}}}'
  );
  await fs.writeFile(path.join(root, 'tsconfig.json'), '{"extends":"./base.json"}');
  const aliases = await loadAliases(root);
  assert.equal(aliasTarget('@/foo', aliases), 'src/foo');
  assert.equal(aliasTarget('@/exact', aliases), 'special.mjs');
  assert.equal(aliases.files.length, 2);
  assert.throws(() => aliasTarget('@/../outside', aliases), /Unsafe/);
  for (const config of [
    { extends: '../outside.json' },
    { extends: 'package/config.json' },
    { compilerOptions: { paths: { '@/*': ['src/*', 'other/*'] } } },
    { compilerOptions: { paths: { '@/*': ['../outside/*'] } } },
    { extends: './tsconfig.json' }
  ]) {
    await saveJson(path.join(root, 'tsconfig.json'), config);
    await assert.rejects(loadAliases(root));
  }
});
test('source and destination can share an alias name with different meanings; extraction is portable and immutable', async (t) => {
  const root = await directory(t),
    options = await fixture(root);
  const entry = path.join(options.source, options.entry);
  const original = await fs.readFile(entry, 'utf8');
  // Fixture imports a local normalize helper; replace only that import's literal in the source fixture.
  const match = original.match(/(['"])(\.\/[^'"]+)\1/);
  assert(match);
  const helper = path.posix.normalize(path.posix.join(path.posix.dirname(options.entry), match[2]));
  await saveJson(path.join(options.source, 'tsconfig.json'), {
    compilerOptions: { paths: { '@helper': [helper] } }
  });
  await fs.writeFile(entry, original.replace(match[0], "'@helper'"));
  await saveJson(path.join(options.target, 'tsconfig.json'), {
    compilerOptions: { paths: { '@helper': ['wrong.mjs'], '@app/*': ['src/*'] } }
  });
  await fs.writeFile(
    path.join(options.target, 'wrong.mjs'),
    'throw Error("must not resolve source alias in destination");'
  );
  const contract = await readJson(options.contract);
  contract.runtime = { aliases: true };
  await saveJson(options.contract, contract);
  assert((await analyze(options)).blockers.length > 0);
  const graph = await analyze({ ...options, aliases: true });
  assert.equal(graph.blockers.length, 0);
  assert.equal(graph.aliases.rewrites.length, 1);
  const plan = await executeCommand('plan', {
    source: options.source,
    target: options.target,
    entry: options.entry,
    aliases: true
  });
  assert.equal(plan.aliasRewrites.length, 1);
  await prepare(options);
  await adapt(options.out, path.join(root, 'proposal.json'));
  const candidate = path.join(options.out, 'candidate');
  // Inspect the actual configured mount instead of assuming a fixture layout.
  const state = await readJson(path.join(options.out, 'state.json'));
  const transferred = path.join(candidate, state.analysis.mount, options.entry);
  assert(!(await fs.readFile(transferred, 'utf8')).includes("'@helper'"));
  assert.equal(await fs.readFile(entry, 'utf8'), original.replace(match[0], "'@helper'"));
  const result = await verify(options.out, { allowExecution: true });
  assert.equal(result.status, 'verified-for-contract', JSON.stringify(result));
  assert.equal(result.version, 9);
  await exportPatch(options.out);
  await fs.appendFile(transferred, '\n// drift');
  await assert.rejects(exportPatch(options.out), /unchanged/);
});
test('alias import failures, undeclared packages, assets and CommonJS aliases remain explicit blockers', async (t) => {
  const root = await directory(t);
  await saveJson(path.join(root, 'tsconfig.json'), { compilerOptions: { paths: { '@/*': ['src/*'] } } });
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src', 'asset.css'), 'body {}');
  for (const text of [
    "import '@/missing.js';",
    "const x=require('@/asset.css');",
    "import 'not-declared';",
    "import '@/asset.css';"
  ]) {
    await fs.writeFile(path.join(root, 'entry.mjs'), text);
    assert((await analyze({ source: root, entry: 'entry.mjs', aliases: true })).blockers.length > 0);
  }
  await fs.writeFile(path.join(root, 'entry.mjs'), 'export const run=()=>1;');
  await fs.rm(path.join(root, 'tsconfig.json'));
  await fs.symlink('/tmp', path.join(root, 'tsconfig.json'));
  await assert.rejects(analyze({ source: root, entry: 'entry.mjs', aliases: true }), /Symlink/);
});
test('destination re-export aliases execute in callable contracts and Node regressions', async (t) => {
  const root = await directory(t),
    options = await fixture(root);
  await fs.rename(
    path.join(options.target, 'src/catalog.mjs'),
    path.join(options.target, 'src/catalog-impl.mjs')
  );
  await fs.writeFile(
    path.join(options.target, 'src/catalog.mjs'),
    "export {searchCatalog,getProduct} from '@app/catalog-impl.mjs';\n"
  );
  await saveJson(path.join(options.target, 'jsconfig.json'), {
    compilerOptions: { paths: { '@app/*': ['src/*'] } }
  });
  const contract = await readJson(options.contract);
  contract.runtime = { aliases: true };
  await saveJson(options.contract, contract);
  const proposal = await readJson(path.join(root, 'proposal.json'));
  proposal.edits[0].path = 'src/catalog-impl.mjs';
  await saveJson(path.join(root, 'proposal.json'), proposal);
  await prepare(options);
  await adapt(options.out, path.join(root, 'proposal.json'));
  const result = await verify(options.out, { allowExecution: true });
  assert.equal(result.status, 'verified-for-contract', JSON.stringify(result));
  assert.equal(result.regression.candidate.status, 'passed');
  await exportPatch(options.out);
});

test('locally inherited alias configuration cannot be changed by adaptation or manual edits', async (t) => {
  const root = await directory(t),
    options = await fixture(root);
  await saveJson(path.join(options.target, 'jsconfig.json'), { extends: './paths.json' });
  await saveJson(path.join(options.target, 'paths.json'), {
    compilerOptions: { paths: { '@app/*': ['src/*'] } }
  });
  const contract = await readJson(options.contract);
  contract.runtime = { aliases: true };
  await saveJson(options.contract, contract);
  await prepare(options);
  const file = path.join(options.out, 'candidate/paths.json'),
    bytes = await fs.readFile(file);
  const proposal = path.join(root, 'bad.json');
  await saveJson(proposal, { edits: [{ path: 'paths.json', beforeSha256: hash(bytes), content: '{}' }] });
  await assert.rejects(adapt(options.out, proposal), /Cannot edit/);
  assert.deepEqual(await fs.readFile(file), bytes);
  await fs.writeFile(file, '{}');
  await assert.rejects(verify(options.out, { allowExecution: true }), /unchanged/);
});
