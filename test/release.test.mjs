import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { releaseInventory, copyRelease } from '../scripts/release-files.mjs';

test('release inventory rejects credentials, symlinks and generated files without printing secrets', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-release-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, '.env'), 'PRIVATE_VALUE');
  await assert.rejects(releaseInventory(root, ['.env']), /Private\/generated path/);
  await fs.writeFile(path.join(root, 'config.json'), JSON.stringify({ key: 'ghp_' + 'a'.repeat(32) }));
  await assert.rejects(releaseInventory(root, ['config.json']), (error) => {
    assert(!error.message.includes('a'.repeat(32)));
    return /Possible credential/.test(error.message);
  });
  await fs.symlink(path.join(root, 'config.json'), path.join(root, 'link'));
  await assert.rejects(releaseInventory(root, ['link']), /non-regular/);
  await fs.mkdir(path.join(root, 'node_modules'));
  await assert.rejects(releaseInventory(root, ['node_modules']), /Private\/generated/);
});

test('source archive copy preserves executable bytes and excludes unselected private files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-release-copy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'cli.mjs'), '#!/usr/bin/env node\n', { mode: 0o755 });
  await fs.writeFile(path.join(root, '.env'), 'PRIVATE_VALUE');
  const inventory = await releaseInventory(root, ['cli.mjs']);
  const copy = path.join(root, 'copy');
  await copyRelease(root, copy, inventory);
  assert.deepEqual(await fs.readdir(copy), ['cli.mjs']);
  assert.deepEqual(await releaseInventory(copy, ['cli.mjs']), inventory);
  assert.equal((await fs.stat(path.join(copy, 'cli.mjs'))).mode & 0o777, 0o755);
});
