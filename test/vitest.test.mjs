import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { summarizeVitest } from '../src/providers/node/vitest-reporter.mjs';
import { regressionFiles, runRegression } from '../src/providers/node/regression.mjs';
const file = (tasks) => ({ type: 'suite', filepath: '/app/a.test.js', result: { state: 'pass' }, tasks });
const passed = { type: 'test', mode: 'run', result: { state: 'pass' } };
test('Vitest completion rejects missing results, empty files, failed hooks, skips and unhandled errors', () => {
  assert.equal(summarizeVitest([file([passed])]).passed, 1);
  assert.equal(summarizeVitest([]).complete, false);
  assert.equal(summarizeVitest([file([])]).errors, 1);
  assert.equal(summarizeVitest([file([{ type: 'test', mode: 'run' }])]).complete, false);
  assert.equal(summarizeVitest([file([{ ...passed, mode: 'skip' }])]).skipped, 1);
  assert.equal(summarizeVitest([file([{ ...passed, mode: 'todo' }])]).todo, 1);
  assert.equal(summarizeVitest([{ ...file([passed]), result: { state: 'fail' } }]).errors, 1);
  assert.equal(summarizeVitest([file([passed])], [new Error('unhandled')]).errors, 1);
});
test('Vitest uses explicit files and refuses filter globs or runner flags that can skip work', () => {
  const spec = (args) => ({ command: 'node', args: ['node_modules/vitest/vitest.mjs', 'run', ...args] });
  assert.deepEqual(regressionFiles(spec(['--environment=jsdom', 'a.test.ts'])), ['a.test.ts']);
  for (const args of [
    [],
    ['*.test.ts'],
    ['--passWithNoTests'],
    ['--testNamePattern=x', 'a.test.ts'],
    ['../a.test.ts'],
    ['a.test.ts', 'a.test.ts']
  ])
    assert.equal(regressionFiles(spec(args)), null);
});
for (const dependency of ['vitest', 'vitest-modern'])
  test(`real ${dependency} proves completion and rejects skipped, empty, failing, crashed and overmatched runs`, async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-vitest-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    await fs.writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
    await fs.mkdir(path.join(dir, 'node_modules'));
    await fs.symlink(path.resolve('node_modules', dependency), path.join(dir, 'node_modules/vitest'), 'dir');
    const run = (files = ['sample.test.js']) =>
      runRegression(
        { command: process.execPath, args: ['node_modules/vitest/vitest.mjs', 'run', ...files] },
        dir,
        20000
      );
    for (const [code, status] of [
      ["import {test,expect} from 'vitest'; test('passes',()=>expect(2+2).toBe(4));", 'passed'],
      ["import {test} from 'vitest'; test.skip('skip',()=>{});", 'failed'],
      ["import {test} from 'vitest'; test.todo('todo');", 'failed'],
      ['export const empty=true;', 'failed'],
      ["import {test,expect} from 'vitest'; test('fails',()=>expect(1).toBe(2));", 'failed'],
      ["throw new Error('collection fails');", 'failed'],
      ['process.exit(0);', 'failed'],
      [
        "import {test,afterAll} from 'vitest'; test('passes',()=>{}); afterAll(()=>{throw new Error('hook failed')});",
        'failed'
      ],
      ["import {test} from 'vitest'; test('dynamic skip',ctx=>ctx.skip());", 'failed']
    ]) {
      await fs.writeFile(path.join(dir, 'sample.test.js'), code);
      const r = await run();
      assert.equal(r.status, status, JSON.stringify(r));
    }
    await fs.writeFile(
      path.join(dir, 'sample.test.js'),
      "import {test} from 'vitest'; test('passes',()=>{});"
    );
    await fs.mkdir(path.join(dir, 'nested'));
    await fs.copyFile(path.join(dir, 'sample.test.js'), path.join(dir, 'nested/sample.test.js'));
    assert.equal(
      (await run()).status,
      'failed',
      'Vitest substring filters must not silently expand explicit selection'
    );
  });
