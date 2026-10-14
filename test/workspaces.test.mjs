import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fixture } from '../scripts/fixture.mjs';
import { prepare, adapt, verify, exportPatch, executeCommand } from '../src/index.mjs';
import { saveJson, readJson } from '../src/platform/files.mjs';
import {
  workspaceLayout,
  dependencyDirectories,
  validateDependencyLinks,
  yamlData
} from '../src/providers/dependencies/workspaces.mjs';
async function dir(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-workspace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function members(root) {
  for (const name of ['a', 'b', 'excluded']) {
    await fs.mkdir(path.join(root, 'packages', name), { recursive: true });
    await saveJson(path.join(root, 'packages', name, 'package.json'), {
      name: '@test/' + name,
      version: '1.0.0',
      type: 'module',
      exports: './index.mjs'
    });
    await fs.writeFile(
      path.join(root, 'packages', name, 'index.mjs'),
      name === 'a' ? "export {value} from '@test/b';" : 'export const value=42;'
    );
  }
}
test('workspace discovery is bounded, records nested manifests and honors excluded members', async (t) => {
  const root = await dir(t);
  await saveJson(path.join(root, 'package.json'), {
    private: true,
    workspaces: ['packages/*', '!packages/excluded']
  });
  await members(root);
  const layout = await workspaceLayout(root, await readJson(path.join(root, 'package.json')));
  assert.deepEqual(
    layout.members.map((p) => p.name),
    ['@test/a', '@test/b']
  );
  assert(layout.metadata['packages/a/package.json']);
  const nested = await workspaceLayout(root, { workspaces: ['packages/**/a'] });
  assert.deepEqual(
    nested.members.map((p) => p.name),
    ['@test/a']
  );
  await saveJson(path.join(root, 'packages/b/package.json'), { name: '@test/a' });
  await assert.rejects(workspaceLayout(root, await readJson(path.join(root, 'package.json'))), /Duplicate/);
});
test('workspace traversal, empty matches, hooks and YAML alias expansion are refused', async (t) => {
  const root = await dir(t);
  for (const pattern of ['../outside', 'packages/{a,b}', 'missing/*']) {
    await saveJson(path.join(root, 'package.json'), { workspaces: [pattern] });
    await assert.rejects(workspaceLayout(root, await readJson(path.join(root, 'package.json'))));
  }
  await saveJson(path.join(root, 'package.json'), { private: true });
  await fs.writeFile(
    path.join(root, 'pnpm-workspace.yaml'),
    'packages: [packages/*]\nconfigDependencies: {untrusted: latest}\n'
  );
  await assert.rejects(workspaceLayout(root, {}), /Unsupported pnpm/);
  assert.throws(() => yamlData('a: &a [1]\nb: *a', 'config'));
});
test('dependency links cannot escape a snapshot and root dependency symlinks are refused', async (t) => {
  const root = await dir(t);
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.symlink('/tmp', path.join(root, 'node_modules', 'outside'));
  await assert.rejects(validateDependencyLinks(root, ['node_modules']), /escapes|relative/);
  await fs.rm(path.join(root, 'node_modules'), { recursive: true });
  await fs.symlink('/tmp', path.join(root, 'node_modules'));
  await assert.rejects(dependencyDirectories(root), /real directories/);
});
test('adaptation preserves nested workspace dependencies and their relative links', async (t) => {
  const root = await dir(t),
    input = await fixture(root);
  await members(input.target);
  const manifest = await readJson(path.join(input.target, 'package.json'));
  manifest.workspaces = ['packages/*'];
  await saveJson(path.join(input.target, 'package.json'), manifest);
  await fs.writeFile(
    path.join(input.target, 'test/workspace.test.mjs'),
    "import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from '../packages/a/index.mjs';test('workspace import',()=>assert.equal(value,42));"
  );
  const contract = await readJson(input.contract);
  contract.regression.args.push('test/workspace.test.mjs');
  await saveJson(input.contract, contract);
  await prepare(input);
  for (const side of ['baseline', 'candidate']) {
    const scope = path.join(input.out, side, 'packages/a/node_modules/@test');
    await fs.mkdir(scope, { recursive: true });
    await fs.symlink(path.relative(scope, path.join(input.out, side, 'packages/b')), path.join(scope, 'b'));
  }
  await adapt(input.out, path.join(root, 'proposal.json'));
  assert.deepEqual(await dependencyDirectories(path.join(input.out, 'candidate')), [
    'packages/a/node_modules'
  ]);
  const v = await verify(input.out, { allowExecution: true });
  assert.equal(v.status, 'verified-for-contract', JSON.stringify(v));
  await exportPatch(input.out);
});

test('doctor detects member-only dependencies and reports workspace directories as presence rather than runtime proof', async (t) => {
  const root = await dir(t);
  await saveJson(path.join(root, 'package.json'), { private: true, workspaces: ['packages/*'] });
  await members(root);
  const before = await executeCommand('doctor', { workspace: root, target: root });
  assert.equal(before.checks.find((c) => c.id === 'destination').status, 'failed');
  assert.equal(before.destination.workspacePackages, 3);
  await fs.mkdir(path.join(root, 'packages/a/node_modules'));
  const after = await executeCommand('doctor', { workspace: root, target: root });
  assert.equal(after.checks.find((c) => c.id === 'destination').status, 'passed');
  assert.match(after.checks.find((c) => c.id === 'destination').value, /completeness.*not validated/);
  assert.deepEqual(after.destination.dependencyDirectories, ['packages/a/node_modules']);
});
