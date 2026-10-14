import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadAliases, aliasTarget } from '../src/providers/javascript/aliases.mjs';
import { saveJson, readJson } from '../src/platform/files.mjs';
import { fixture } from '../scripts/fixture.mjs';
import { prepare, adapt, verify, exportPatch } from '../src/index.mjs';
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-framework-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test('Vite path expressions are parsed without executing config, plugins or side effects', async (t) => {
  const root = await directory(t);
  await fs.writeFile(
    path.join(root, 'vite.config.ts'),
    `import {defineConfig} from 'vite';import {fileURLToPath,URL} from 'node:url';import {resolve} from 'node:path';throw Error('must not execute');export default defineConfig({plugins:[arbitrary()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url)),'utils':resolve(__dirname,'lib')}}});`
  );
  const a = await loadAliases(root);
  assert.equal(aliasTarget('@/a.ts', a), 'src/a.ts');
  assert.equal(aliasTarget('utils/a.ts', a), 'lib/a.ts');
  assert.deepEqual(a.providers, ['vite']);
  assert.equal(a.files[0].path, 'vite.config.ts');
});
test('SvelteKit 2 derives $lib and kit.alias without generated tsconfig or environment execution', async (t) => {
  const root = await directory(t);
  await saveJson(path.join(root, 'package.json'), { devDependencies: { '@sveltejs/kit': '^2.63.1' } });
  await saveJson(path.join(root, 'tsconfig.json'), { extends: './.svelte-kit/tsconfig.json' });
  await fs.writeFile(
    path.join(root, 'svelte.config.js'),
    `const config={kit:{files:{lib:'custom'},alias:{'$/*':'./src/lib/*'},adapter:runUntrustedPlugin()}};export default config;`
  );
  await fs.writeFile(
    path.join(root, 'vite.config.js'),
    `export default {resolve:process.env.TEST?{conditions:['browser']}:undefined};`
  );
  const a = await loadAliases(root);
  assert.equal(aliasTarget('$lib/a.ts', a), 'custom/a.ts');
  assert.equal(aliasTarget('$/b.ts', a), 'src/lib/b.ts');
  assert(a.providers.includes('sveltekit-2'));
  await assert.rejects(fs.stat(path.join(root, '.svelte-kit')));
});
test('conflicting, conditional, spread and escaping framework aliases fail instead of guessing', async (t) => {
  const root = await directory(t);
  for (const config of [
    "export default ()=>({resolve:{alias:{'@':'src'}}})",
    "export default {resolve:flag?{alias:{'@':'one'}}:{alias:{'@':'two'}}}",
    "export default {...other,resolve:{alias:{'@':'/tmp/outside'}}}",
    "export default {resolve:{alias:{'@':'relative'}}}"
  ]) {
    await fs.writeFile(path.join(root, 'vite.config.js'), config);
    await assert.rejects(loadAliases(root));
  }
  await fs.writeFile(
    path.join(root, 'vite.config.js'),
    "import {fileURLToPath} from 'node:url';export default {resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}}}"
  );
  await saveJson(path.join(root, 'tsconfig.json'), { compilerOptions: { paths: { '@/*': ['other/*'] } } });
  await assert.rejects(loadAliases(root), /Conflicting/);
  await saveJson(path.join(root, 'portsmith.aliases.json'), {
    compilerOptions: { paths: { '@/*': ['explicit/*'] } }
  });
  assert.equal(aliasTarget('@/a', await loadAliases(root)), 'explicit/a');
});
test('local explicit paths and baseUrl can override package compiler config without reading dependency code', async (t) => {
  const root = await directory(t);
  await saveJson(path.join(root, 'tsconfig.json'), {
    extends: '@vue/tsconfig/tsconfig.json',
    compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } }
  });
  assert.equal(aliasTarget('@/x', await loadAliases(root)), 'src/x');
  await saveJson(path.join(root, 'tsconfig.json'), {
    extends: '@vue/tsconfig/tsconfig.json',
    compilerOptions: { paths: { '@/*': ['src/*'] } }
  });
  await assert.rejects(loadAliases(root), /Package config/);
});
test('framework aliases survive extraction, native verification and patch export', async (t) => {
  const root = await directory(t),
    options = await fixture(root),
    entry = path.join(options.source, options.entry),
    text = await fs.readFile(entry, 'utf8'),
    match = text.match(/(['"])(\.\/[^'"]+)\1/),
    helper = path.posix.normalize(path.posix.join(path.posix.dirname(options.entry), match[2]));
  await fs.writeFile(
    path.join(options.source, 'vite.config.mjs'),
    `import {fileURLToPath} from 'node:url';export default {resolve:{alias:{'@helper':fileURLToPath(new URL('./${helper}',import.meta.url))}}};`
  );
  await fs.writeFile(entry, text.replace(match[0], "'@helper'"));
  const contract = await readJson(options.contract);
  contract.runtime = { aliases: true };
  await saveJson(options.contract, contract);
  await prepare(options);
  await adapt(options.out, path.join(root, 'proposal.json'));
  assert.equal((await verify(options.out, { allowExecution: true })).status, 'verified-for-contract');
  await exportPatch(options.out);
});

test('framework defaults and URL aliases preserve path semantics and reject shadowed constructors', async (t) => {
  const root = await directory(t);
  await saveJson(path.join(root, 'package.json'), { devDependencies: { '@sveltejs/kit': '^2.0.0' } });
  await fs.writeFile(path.join(root, 'svelte.config.js'), 'export default {};');
  assert.equal(aliasTarget('$lib/x', await loadAliases(root)), 'src/lib/x');
  await fs.rm(path.join(root, 'svelte.config.js'));
  for (const expression of [
    "new URL('https://example.com/x',import.meta.url)",
    "new URL('./src?query',import.meta.url)"
  ]) {
    await fs.writeFile(
      path.join(root, 'vite.config.mjs'),
      `import {fileURLToPath} from 'node:url';export default {resolve:{alias:{'@':fileURLToPath(${expression})}}}`
    );
    await assert.rejects(loadAliases(root));
  }
  await fs.writeFile(
    path.join(root, 'vite.config.mjs'),
    "let URL=custom;import {fileURLToPath} from 'node:url';export default {resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}}}"
  );
  await assert.rejects(loadAliases(root));
  await fs.writeFile(
    path.join(root, 'vite.config.mjs'),
    "import {fileURLToPath} from 'node:url';export default {resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}}}"
  );
  assert.equal(aliasTarget('@/entry.ts', await loadAliases(root)), 'entry.ts');
});

test('explicit config mutations are rejected without executing them', async (t) => {
  const root = await directory(t);
  for (const mutation of [
    "config.resolve.alias['@']='/elsewhere';",
    "Object.assign(config,{resolve:{alias:{'@':'/elsewhere'}}});",
    'delete config.resolve.alias;'
  ]) {
    await fs.writeFile(
      path.join(root, 'vite.config.js'),
      "const config={resolve:{alias:{'@':'/original'}}};" + mutation + 'export default config;'
    );
    await assert.rejects(loadAliases(root), /Mutated/);
  }
});
