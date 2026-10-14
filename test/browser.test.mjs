import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { project } from '../scripts/fixture.mjs';
import { browserFixture } from '../scripts/browser-fixture.mjs';
import { prepare, adapt, verify, exportPatch } from '../src/index.mjs';
import { readJson, saveJson } from '../src/platform/files.mjs';
import { validateContract } from '../src/contracts/behavior.mjs';
async function setup(t, mutate) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-browser-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = await browserFixture(root);
  if (mutate) await mutate(options);
  await prepare(options);
  await adapt(options.out, path.join(root, 'proposal.json'));
  return { root, options };
}
test('a custom browser cache cannot silently fall back to a host browser installation', async (t) => {
  const { root, options } = await setup(t);
  const missingCache = path.join(root, 'missing-browser-cache');
  const result = spawnSync(
    process.execPath,
    [path.join(project, 'src/cli.mjs'), 'verify', '--run', options.out, '--allow-execution'],
    {
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: missingCache },
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024
    }
  );
  assert.equal(result.error, undefined);
  const report = await readJson(path.join(options.out, 'verification.json'));
  assert.equal(report.status, 'failed');
  assert.equal(report.browser.candidate.status, 'error');
  assert.match(report.browser.candidate.error, /executable doesn't exist/i);
  assert(report.browser.candidate.error.includes(missingCache));
  await assert.rejects(exportPatch(options.out), /passing contract/);
});
test('browser interaction passes on candidate, fails baseline, preserves reset, and binds screenshots/traces', async (t) => {
  const { options } = await setup(t);
  const report = await verify(options.out, { allowExecution: true, timeoutMs: 30000 });
  assert.equal(report.status, 'verified-for-contract', JSON.stringify(report.browser));
  assert.equal(report.version, 3);
  assert.equal(report.browser.baselineDemonstratesGap, true);
  assert.equal(report.browser.candidate.cases.length, 2);
  assert.equal(report.browser.candidate.regression[0].status, 'passed');
  assert.equal(report.browser.candidate.artifacts.length, 6);
  assert.equal((await exportPatch(options.out)).status, 'patch-ready');
  await fs.appendFile(path.join(options.out, report.browser.candidate.artifacts[0].path), 'changed');
  await assert.rejects(exportPatch(options.out), /Browser evidence changed/);
});
test('passing Node behavior cannot hide broken browser event wiring or page runtime errors', async (t) => {
  const { options } = await setup(t);
  const file = path.join(options.out, 'candidate/index.html');
  const html = await fs.readFile(file, 'utf8');
  await fs.writeFile(
    file,
    html.replace("input.addEventListener('input',render)", "input.addEventListener('change',render)")
  );
  let report = await verify(options.out, { allowExecution: true, timeoutMs: 30000 });
  assert.equal(report.candidate.status, 'passed');
  assert.equal(report.status, 'failed');
  await assert.rejects(exportPatch(options.out), /passing contract/);
  await fs.writeFile(
    file,
    html.replace('render();\n</script>', "render();throw new Error('broken page');\n</script>")
  );
  report = await verify(options.out, { allowExecution: true, timeoutMs: 30000 });
  assert.equal(report.browser.candidate.cases[0].status, 'error');
  assert.equal(report.status, 'failed');
});
test('missing action targets are execution errors, not a valid baseline gap', async (t) => {
  const { options } = await setup(t, async (options) => {
    const contract = await readJson(options.contract);
    contract.browser.cases[0].steps[0].selector = '#missing';
    await saveJson(options.contract, contract);
  });
  const report = await verify(options.out, { allowExecution: true, timeoutMs: 30000 });
  assert.equal(report.browser.baselineDemonstratesGap, false);
  assert.equal(report.status, 'failed');
});
test('browser contracts reject no assertions, no regressions and external page paths', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-browser-schema-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = await browserFixture(root),
    original = await readJson(options.contract);
  for (const edit of [
    (c) => (c.browser.cases[0].assertions = []),
    (c) => (c.browser.regression = []),
    (c) => (c.browser.page = 'https://example.com'),
    (c) => (c.browser.server = { command: 'node', args: ['server.mjs'] })
  ]) {
    const c = structuredClone(original);
    edit(c);
    assert.throws(() => validateContract(c));
  }
});
test('old function-only verification cannot export a browser contract', async (t) => {
  const { options } = await setup(t);
  const fake = { version: 2, status: 'verified-for-contract' };
  await saveJson(path.join(options.out, 'verification.json'), fake);
  await assert.rejects(exportPatch(options.out), /passing contract/);
});
test('a configured local app server is started, checked and stopped for each snapshot', async (t) => {
  const { options } = await setup(t, async (options) => {
    await fs.writeFile(
      path.join(options.target, 'server.mjs'),
      `import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';
http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';res.setHeader('content-type',name.endsWith('.html')?'text/html':'text/javascript');res.end(await fs.readFile(path.resolve(name)));}catch{res.writeHead(404);res.end();}}).listen(Number(process.argv[2]),'127.0.0.1');`
    );
    const contract = await readJson(options.contract);
    contract.browser.server = { command: process.execPath, args: ['server.mjs', '{port}'] };
    await saveJson(options.contract, contract);
  });
  const report = await verify(options.out, { allowExecution: true, timeoutMs: 30000 });
  assert.equal(report.status, 'verified-for-contract', JSON.stringify(report.browser));
});
test('browser timeout is a failure and an unchanged baseline regression must still pass after adaptation', async (t) => {
  const { options } = await setup(t);
  const file = path.join(options.out, 'candidate/index.html'),
    html = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, html.replace("input.value='';render();", "input.value='wrong';render();"));
  let report = await verify(options.out, { allowExecution: true, timeoutMs: 30000 });
  assert.equal(report.candidate.status, 'passed');
  assert.equal(report.browser.baseline.regression[0].status, 'passed');
  assert.notEqual(report.browser.candidate.regression[0].status, 'passed');
  assert.equal(report.status, 'failed');
  report = await verify(options.out, { allowExecution: true, timeoutMs: 5 });
  assert.equal(report.status, 'failed');
  assert.equal(report.browser.candidate.status, 'error');
});
