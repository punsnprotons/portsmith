import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { exportObservations } from '../src/providers/javascript/exports.mjs';
const scan = (text) =>
  exportObservations(ts.createSourceFile('feature.ts', text, ts.ScriptTarget.Latest, true), 'feature.ts');
test('export discovery retains exact locations, aliases, functions and type-only boundaries without executing code', () => {
  const result = scan(
    '// comment\n\nexport function read() { throw Error("must never execute"); }\nexport const run = () => 42;\nexport const {item} = value;\nexport interface Shape {}\nexport type Key = string;\nexport {read as alias};\nexport type {Shape as Other};\nexport {foo as forwarded} from "./other.js";\nexport * from "./star.js";\nexport default run;'
  );
  assert.equal(result.find((x) => x.name === 'read').line, 3);
  assert.equal(result.find((x) => x.name === 'read').column, 1);
  assert.equal(result.find((x) => x.name === 'alias').callable, 'function-syntax');
  assert.equal(result.find((x) => x.name === 'default').callable, 'function-syntax');
  assert.equal(result.find((x) => x.name === 'forwarded').from, './other.js');
  assert.equal(result.find((x) => x.name === 'forwarded').callable, 'unknown');
  assert(result.find((x) => x.name === 'Shape').typeOnly);
  assert(result.find((x) => x.name === 'Other').typeOnly);
  assert(result.some((x) => x.name === 'item'));
  assert(result.some((x) => x.name === '*'));
});
test('CommonJS discovery distinguishes syntax from runtime behavior and ignores nested or shadowed assignments', () => {
  assert.equal(scan('module.exports = function(value) { return value; };')[0].callable, 'function-syntax');
  assert.deepEqual(
    scan('exports.foo = x; module.exports.bar = () => 1;').map((x) => [x.name, x.callable]),
    [
      ['foo', 'unknown'],
      ['bar', 'function-syntax']
    ]
  );
  assert.equal(scan('function fake(module) { module.exports = 1; }').length, 0);
  assert.equal(scan('const module = {}; module.exports = 1;').length, 0);
  assert.equal(scan('let exports; exports.foo = 1;').length, 0);
});
test('declaration-only exports never appear as runtime callable candidates', () => {
  const ast = ts.createSourceFile(
    'feature.d.ts',
    'export declare function foo(): void;',
    ts.ScriptTarget.Latest,
    true
  );
  const result = exportObservations(ast, 'feature.d.ts');
  assert.equal(result[0].typeOnly, true);
  assert.equal(result[0].callable, 'unknown');
});
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { analyze } from '../src/providers/javascript/analyze.mjs';
import { runProcess } from '../src/platform/process.mjs';
test('inspect gives accurate import locations and readable export names through the public CLI', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-export-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const d of ['source', 'target']) await fs.mkdir(path.join(root, d));
  await fs.writeFile(
    path.join(root, 'source', 'entry.mjs'),
    '// heading\n\nimport { helper } from "./helper.mjs";\n\nexport const run = () => helper();\n'
  );
  await fs.writeFile(path.join(root, 'source', 'helper.mjs'), 'export function helper() { return 1; }');
  const input = { source: path.join(root, 'source'), target: path.join(root, 'target'), entry: 'entry.mjs' };
  const result = await analyze(input);
  assert.equal(result.edges[0].line, 3);
  assert.equal(result.exports.find((e) => e.name === 'run').line, 5);
  const cli = await runProcess(process.execPath, [
    path.resolve('src/cli.mjs'),
    'inspect',
    '--source',
    input.source,
    '--target',
    input.target,
    '--entry',
    input.entry,
    '--human'
  ]);
  assert.equal(cli.exitCode, 0, cli.stderr);
  assert.match(cli.stdout, /run — function-syntax \(entry.mjs:5\)/);
  assert.match(cli.stdout, /not runtime proof/);
});
import { executeCommand, commandResult } from '../src/index.mjs';
test('source-only inspection leaves dependency compatibility unchecked while transfer planning still requires a target', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-inspect-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { pako: '1.0.0' } }));
  await fs.writeFile(
    path.join(root, 'entry.mjs'),
    'import pako from "pako"; export function run() { return pako; }'
  );
  const result = await executeCommand('inspect', { source: root, entry: 'entry.mjs' }, { root });
  assert.equal(result.target, null);
  assert.equal(result.externals[0].status, 'not-compared');
  assert.equal(result.blockers.length, 0);
  assert(result.limitations.some((x) => /not compared/.test(x)));
  assert.equal(
    (await commandResult('plan', { source: root, entry: 'entry.mjs' })).error.code,
    'invalid_input'
  );
  const cli = await runProcess(process.execPath, [
    path.resolve('src/cli.mjs'),
    'inspect',
    '--source',
    root,
    '--entry',
    'entry.mjs',
    '--human'
  ]);
  assert.equal(cli.exitCode, 0, cli.stderr);
  assert.match(cli.stdout, /compatibility not compared/);
  await fs.writeFile(path.join(root, 'entry.mjs'), 'import value from "$lib/unknown"; export default value;');
  const blocked = await executeCommand('inspect', { source: root, entry: 'entry.mjs' });
  assert(blocked.blockers.some((x) => x.includes('unsupported path alias')));
});
