import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fixture, project } from '../scripts/fixture.mjs';
import { executeCommand, commandResult, schemaFor, capabilities } from '../src/index.mjs';
import { commands } from '../src/contracts/commands.mjs';
import { runProcess } from '../src/platform/process.mjs';

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-service-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, options: await fixture(root) };
}

test('public service returns actionable diagnostics for malformed input and unknown commands', async () => {
  const invalid = await commandResult('inspect', { source: '/source' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'invalid_input');
  assert.ok(invalid.error.remediation);
  assert.ok(invalid.error.details.issues.length);
  const unknown = await commandResult('constructor', {});
  assert.equal(unknown.error.code, 'unknown_command');
});

test('every command has a discoverable JSON Schema and shared capability metadata', () => {
  const catalog = capabilities();
  assert.equal(catalog.operations.length, Object.keys(commands).length);
  for (const name of Object.keys(commands)) {
    assert.equal(schemaFor(name).schema.type, 'object');
    assert.equal(schemaFor(name).schema.additionalProperties, false);
  }
  assert.equal(schemaFor('contract').schema.properties.version.const, 1);
  assert.equal(schemaFor('proposal').schema.properties.edits.type, 'array');
  assert.equal(catalog.operations.find((c) => c.name === 'verify').available, false);
});

test('plan observes destination conventions and identifies collisions before preparation', async (t) => {
  const { options } = await setup(t);
  const input = {
    source: options.source,
    target: options.target,
    entry: options.entry,
    mount: options.mount
  };
  const plan = await executeCommand('plan', input);
  assert.equal(plan.status, 'ready-to-define-contract');
  assert.equal(plan.destination.moduleType, 'module');
  assert.equal(plan.files.length, 2);
  assert.ok(plan.generatedFiles.some((f) => f.destination === options.mount + '/package.json'));
  await fs.mkdir(path.join(options.target, options.mount), { recursive: true });
  await fs.writeFile(path.join(options.target, options.mount, 'LICENSE'), 'existing notice');
  const blocked = await executeCommand('plan', input);
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.blockers[0], /LICENSE/);
  await fs.writeFile(path.join(options.target, options.mount, 'package.json'), '{}');
  assert.ok((await executeCommand('plan', input)).blockers.some((b) => b.includes('package.json')));
});

test('service execution requires both policy and per-call authorization', async () => {
  for (const [input, policy] of [
    [{ run: '/run', allowExecution: true }, {}],
    [{ run: '/run' }, { allowExecution: true }]
  ]) {
    const denied = await commandResult('verify', input, policy);
    assert.equal(denied.error.code, 'execution_not_authorized');
  }
});

test('service completes transfer and reports stale verification', async (t) => {
  const { root, options } = await setup(t);
  await executeCommand('prepare', options);
  await executeCommand('adapt', { run: options.out, proposal: path.join(root, 'proposal.json') });
  const verified = await executeCommand(
    'verify',
    { run: options.out, allowExecution: true },
    { allowExecution: true }
  );
  assert.equal(verified.status, 'verified-for-contract');
  const report = await executeCommand('report', { run: options.out });
  assert.equal(report.behavior.candidate.passed, 5);
  await fs.appendFile(path.join(options.out, 'candidate/src/catalog.mjs'), '\n// changed\n');
  assert.equal((await executeCommand('report', { run: options.out })).status, 'stale');
  const failed = await commandResult('export', { run: options.out });
  assert.equal(failed.error.code, 'verification_stale');
});

test('CLI supports human output, schemas, saved JSON and command-specific diagnostics', async (t) => {
  const { root } = await setup(t);
  const cli = (...args) =>
    runProcess(process.execPath, [path.join(project, 'src/cli.mjs'), ...args], { cwd: root });
  const doctor = await cli('doctor', '--workspace', root, '--human');
  assert.equal(doctor.exitCode, 0);
  assert.match(doctor.stdout, /ready\n/);
  const out = path.join(root, 'schema.json');
  const schema = await cli('schema', '--command', 'contract', '--json', '--output', out);
  assert.equal(schema.exitCode, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(out, 'utf8')), JSON.parse(schema.stdout));
  const invalid = await cli('status', '--run', root, '--source', root, '--json');
  assert.equal(JSON.parse(invalid.stderr).error.code, 'invalid_option');
  const help = await cli('prepare', '--help');
  assert.match(help.stdout, /--contract VALUE/);
});

test('provider and domain modules do not import application workflows or entrypoint adapters', async () => {
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const name = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(name);
      else if (name.endsWith('.mjs')) {
        const code = await fs.readFile(name, 'utf8');
        assert.doesNotMatch(code, /(?:from\s*|import\s*)['"][^'"]*(?:application|adapters)\//, name);
      }
    }
  }
  await walk(path.join(project, 'src/providers'));
  await walk(path.join(project, 'src/domain'));
});
