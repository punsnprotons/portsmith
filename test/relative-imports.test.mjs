import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from '../src/platform/process.mjs';
import { runRegression } from '../src/providers/node/regression.mjs';
import { analyze } from '../src/providers/javascript/analyze.mjs';
import { inventory, excluded } from '../src/platform/files.mjs';

test('relative resolver is opt-in, supports nested JS/TS and rejects missing, bare and escaping fallback', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-relative-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const app = path.join(dir, 'app');
  await fs.mkdir(path.join(app, 'nested'), { recursive: true });
  await fs.writeFile(path.join(app, 'package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(app, 'nested/index.js'), "export {value} from '../value';");
  await fs.writeFile(path.join(app, 'value.ts'), 'export const value: number = 42;');
  const register = path.resolve('src/providers/node/register-relative.mjs');
  const run = (code, enabled = true) =>
    runProcess(
      process.execPath,
      [...(enabled ? ['--import', register] : []), '--input-type=module', '-e', code],
      { cwd: app }
    );
  const code = "import {value} from './nested'; if(value!==42)throw Error('bad value');";
  assert.equal((await run(code)).exitCode, 0);
  assert.notEqual((await run(code, false)).exitCode, 0);
  await fs.writeFile(path.join(dir, 'outside.js'), 'export const x=1;');
  await fs.symlink(path.join(dir, 'outside.js'), path.join(app, 'escape.js'));
  for (const spec of ['./missing', '@/value', '../outside', './escape'])
    assert.notEqual((await run(`import '${spec}';`)).exitCode, 0, spec);
  await fs.writeFile(
    path.join(app, 'a.test.mjs'),
    "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {value} from './nested'; test('real value',()=>assert.equal(value,42));"
  );
  const regression = { command: process.execPath, args: ['--test', 'a.test.mjs'] };
  assert.equal((await runRegression(regression, app, 10000, { relativeImports: true })).status, 'passed');
  assert.equal((await runRegression(regression, app, 10000)).status, 'failed');
});

test('runtime connection ignores erased type imports; extraction still traces declarations', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-types-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source'),
    target = path.join(dir, 'target');
  await fs.mkdir(source);
  await fs.mkdir(target);
  await fs.writeFile(
    path.join(source, 'entry.ts'),
    "import type {State} from '$lib/types'; import {type Feature} from './feature'; import type Alias = require('./feature'); export const value=1;"
  );
  await fs.writeFile(path.join(source, 'feature.ts'), 'export type Feature = number;');
  const runtime = await analyze({ source, target, entry: 'entry.ts', runtimeOnly: true });
  assert.deepEqual(runtime.blockers, []);
  assert.equal(
    runtime.files.some((f) => f.path === 'feature.ts'),
    false
  );
  const extraction = await analyze({ source, target, entry: 'entry.ts' });
  assert.ok(extraction.blockers.length > 0);
  assert.ok(extraction.files.some((f) => f.path === 'feature.ts'));
  assert.equal(excluded('.svelte-kit/generated/client.js'), true);
  await fs.mkdir(path.join(source, '.svelte-kit'));
  await fs.symlink('/missing/generated', path.join(source, '.svelte-kit/output'));
  assert.ok((await inventory(source))['entry.ts']);
});
