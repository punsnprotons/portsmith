import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runRegression } from '../src/providers/node/regression.mjs';
test('Node startup and assertion failures retain bounded diagnostics and cannot verify', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-diagnostics-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const source of [
    "throw Error('startup-sentinel');",
    "import {test}from'node:test';import assert from'node:assert/strict';test('broken',()=>assert.equal('assertion-sentinel','expected'));"
  ]) {
    await fs.writeFile(path.join(root, 'failure.test.mjs'), source);
    const result = await runRegression(
      { command: process.execPath, args: ['--test', 'failure.test.mjs'] },
      root,
      10000
    );
    assert.equal(result.status, 'failed');
    assert.match(result.counts.diagnostics.join(''), /sentinel/);
    assert(result.counts.diagnostics.join('').length <= 8000);
  }
});
