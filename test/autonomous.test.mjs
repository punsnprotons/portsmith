import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fixture } from '../scripts/fixture.mjs';
import { prepare, autoAdapt, commandResult } from '../src/index.mjs';
import { readJson, saveJson, inventory, same } from '../src/platform/files.mjs';
import { modelConfig, propose } from '../src/providers/model/client.mjs';

async function setup(t, respond) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-auto-'));
  const options = await fixture(root);
  await prepare(options);
  const proposal = await readJson(path.join(root, 'proposal.json'));
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    calls++;
    await respond({ req, res, body: JSON.parse(body), calls, proposal });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const config = path.join(root, 'model.json');
  await saveJson(config, {
    baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    model: 'protocol-test-double',
    apiKeyEnv: 'PORTSMITH_TEST_KEY',
    timeoutMs: 3000,
    maxContextBytes: 200000
  });
  process.env.PORTSMITH_TEST_KEY = 'fake-test-key';
  t.after(async () => {
    delete process.env.PORTSMITH_TEST_KEY;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, options, config, calls: () => calls };
}
const reply = (res, proposal) => {
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      model: 'protocol-test-double',
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(proposal) } }],
      usage: { total_tokens: 100 }
    })
  );
};

test('autonomous loop repairs a failed model edit, verifies and exports without touching originals', async (t) => {
  const env = await setup(t, async ({ res, body, calls, proposal }) => {
    const context = JSON.parse(body.messages[1].content),
      file = context.files.find((f) => f.path === 'src/catalog.mjs');
    assert.equal(body.model, 'protocol-test-double');
    assert.equal(body.store, false);
    assert.equal(body.response_format.json_schema.strict, true);
    if (calls === 1)
      reply(res, {
        edits: [
          {
            path: file.path,
            beforeSha256: file.sha256,
            content:
              "import {filterRows} from './features/table-filter/src/filter.mjs';\nexport function searchCatalog(){throw new Error('repair me')}\nexport const products=[];"
          }
        ]
      });
    else {
      assert.notEqual(context.verification.candidate.status, 'passed');
      proposal.edits[0].beforeSha256 = file.sha256;
      reply(res, proposal);
    }
  });
  const before = await inventory(env.options.target);
  const result = await autoAdapt(env.options.out, {
    config: env.config,
    allowModel: true,
    allowExecution: true,
    maxAttempts: 3
  });
  assert.equal(result.status, 'verified-for-contract');
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].status, 'failed');
  assert.equal(result.patch.status, 'patch-ready');
  assert.ok(same(before, await inventory(env.options.target)));
  const record = await fs.readFile(path.join(result.evidence, 'summary.json'), 'utf8');
  assert.ok(!record.includes('fake-test-key'));
});
test('model test edits are rejected without mutating the candidate and attempts are bounded', async (t) => {
  const env = await setup(t, async ({ res, body }) => {
    const c = JSON.parse(body.messages[1].content),
      file = c.files.find((f) => f.path === 'test/catalog.test.mjs');
    reply(res, { edits: [{ path: file.path, beforeSha256: file.sha256, content: '' }] });
  });
  const before = await inventory(path.join(env.options.out, 'candidate'));
  const result = await autoAdapt(env.options.out, {
    config: env.config,
    allowModel: true,
    allowExecution: true,
    maxAttempts: 2
  });
  assert.equal(result.status, 'attempts-exhausted');
  assert.equal(env.calls(), 2);
  assert.equal(result.patch, null);
  assert.equal(result.attempts[0].error.code, 'protected_edit');
  const rejected = JSON.parse(await fs.readFile(result.attempts[0].proposal, 'utf8'));
  assert.equal(rejected.edits[0].path, 'test/catalog.test.mjs');
  assert.equal(rejected.edits[0].content, '');
  assert.ok(same(before, await inventory(path.join(env.options.out, 'candidate'))));
});
test('autonomy requires separate model authorization and rejects missing execution policy', async () => {
  await assert.rejects(autoAdapt('/missing', { allowExecution: true }), /requires model transmission/);
  const result = await commandResult('auto-adapt', {
    run: '/missing',
    config: '/missing',
    allowModel: true,
    allowExecution: true
  });
  assert.equal(result.error.code, 'execution_not_authorized');
});
test('provider HTTP failures are classified without storing response body or retrying indefinitely', async (t) => {
  const env = await setup(t, async ({ res }) => {
    res.writeHead(429);
    res.end('secret provider body');
  });
  const result = await autoAdapt(env.options.out, {
    config: env.config,
    allowModel: true,
    allowExecution: true
  });
  assert.equal(result.status, 'blocked');
  assert.equal(env.calls(), 1);
  assert.equal(result.attempts[0].error.code, 'model_request_failed');
  assert.ok(!JSON.stringify(result).includes('secret provider body'));
});
test('provider enforces complete structured JSON, timeout and credential transport boundaries', async (t) => {
  const env = await setup(t, async ({ res }) =>
    res.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }))
  );
  const config = modelConfig(await readJson(env.config));
  await assert.rejects(propose(config, {}), (e) => e.code === 'model_incomplete');
  for (const baseURL of [
    'http://remote.example/v1',
    'https://user:pass@example.com/v1',
    'https://example.com/v1?key=secret'
  ])
    assert.throws(() => modelConfig({ ...config, baseURL }), /HTTPS or loopback/);
});
test('invalid model JSON never becomes a candidate edit', async (t) => {
  const env = await setup(t, async ({ res }) =>
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'not json' } }] }))
  );
  const before = await inventory(path.join(env.options.out, 'candidate'));
  const result = await autoAdapt(env.options.out, {
    config: env.config,
    allowModel: true,
    allowExecution: true,
    maxAttempts: 1
  });
  assert.equal(result.status, 'attempts-exhausted');
  assert.equal(result.attempts[0].error.code, 'model_invalid_response');
  assert.ok(same(before, await inventory(path.join(env.options.out, 'candidate'))));
});
test('provider timeout stops a stalled response', async (t) => {
  const env = await setup(t, async () => {});
  const config = modelConfig({ ...(await readJson(env.config)), timeoutMs: 100 });
  const start = Date.now();
  await assert.rejects(propose(config, {}), (e) => e.code === 'model_timeout');
  assert.ok(Date.now() - start < 3000);
});
test('bounded context fails explicitly before transmission and adaptation preserves provisioned dependencies', async (t) => {
  const env = await setup(t, async ({ res, proposal }) => reply(res, proposal));
  const config = await readJson(env.config);
  config.maxContextBytes = 1000;
  await saveJson(env.config, config);
  let result = await autoAdapt(env.options.out, {
    config: env.config,
    allowModel: true,
    allowExecution: true
  });
  assert.equal(result.status, 'preflight-failed');
  assert.equal(result.attempts.length, 0);
  assert.equal(result.blockers[0].code, 'model_context_limit');
  assert.equal(env.calls(), 0);
  config.maxContextBytes = 200000;
  await saveJson(env.config, config);
  const modules = path.join(env.options.out, 'candidate/node_modules');
  await fs.mkdir(modules);
  await fs.writeFile(path.join(modules, 'provisioned'), 'retained');
  result = await autoAdapt(env.options.out, { config: env.config, allowModel: true, allowExecution: true });
  assert.equal(result.status, 'verified-for-contract');
  assert.equal(await fs.readFile(path.join(modules, 'provisioned'), 'utf8'), 'retained');
});
test('CLI and MCP both complete authorized autonomous transfers through the shared service', async (t) => {
  const env = await setup(t, async ({ res, proposal }) => reply(res, proposal));
  const { execFile } = await import('node:child_process'),
    { promisify } = await import('node:util');
  const { project } = await import('../scripts/fixture.mjs');
  const cli = await promisify(execFile)(
    process.execPath,
    [
      path.join(project, 'src/cli.mjs'),
      'auto-adapt',
      '--run',
      env.options.out,
      '--config',
      env.config,
      '--allow-execution',
      '--allow-model',
      '--max-attempts',
      '1',
      '--json'
    ],
    { env: { PATH: process.env.PATH, PORTSMITH_TEST_KEY: 'fake-test-key' }, timeout: 15000 }
  );
  assert.equal(JSON.parse(cli.stdout).status, 'verified-for-contract');
  // A fresh run exercises model generation through MCP, not an already-verified shortcut.
  const other = { ...env.options, out: path.join(env.root, 'mcp-run') };
  await prepare(other);
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'autonomy-test', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(project, 'src/mcp.mjs'), '--root', env.root, '--allow-execution'],
    env: { PATH: process.env.PATH, PORTSMITH_TEST_KEY: 'fake-test-key' },
    stderr: 'pipe'
  });
  t.after(() => client.close());
  await client.connect(transport);
  const denied = await client.callTool({
    name: 'auto_adapt_transfer',
    arguments: { run: other.out, config: env.config, allowExecution: true }
  });
  assert.equal(denied.isError, true);
  const result = await client.callTool({
    name: 'auto_adapt_transfer',
    arguments: { run: other.out, config: env.config, allowExecution: true, allowModel: true, maxAttempts: 1 }
  });
  assert.equal(result.structuredContent.status, 'verified-for-contract');
  assert.equal(result.structuredContent.patch.status, 'patch-ready');
});
test('autonomy rejects an unconnected reimplementation even when its behavior would pass', async (t) => {
  const env = await setup(t, async ({ res, body }) => {
    const c = JSON.parse(body.messages[1].content),
      file = c.files.find((f) => f.path === 'src/catalog.mjs');
    reply(res, {
      edits: [
        {
          path: file.path,
          beforeSha256: file.sha256,
          content: file.content.replace(
            'return products.map(product => ({ ...product }));',
            `const normalize = value => String(value).normalize('NFD').replace(/\\p{Diacritic}/gu,'').trim().toLowerCase(); return products.filter(p=>normalize(p.name).includes(normalize(query))).map(p=>({...p}));`
          )
        }
      ]
    });
  });
  const result = await autoAdapt(env.options.out, {
    config: env.config,
    allowModel: true,
    allowExecution: true,
    maxAttempts: 1
  });
  assert.equal(result.status, 'attempts-exhausted');
  assert.equal(result.patch, null);
  assert.equal(result.attempts[0].error.code, 'feature_not_connected');
});

test('explicit context includes Vue UI, target, source and regressions while reporting omitted files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-context-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = await fixture(root);
  await fs.writeFile(path.join(options.target, 'src/App.vue'), '<template>App</template>');
  await fs.writeFile(
    path.join(options.target, 'unrelated.json'),
    JSON.stringify({ text: 'x'.repeat(250000) })
  );
  await prepare(options);
  const { loadRun } = await import('../src/application/transfer.mjs');
  const { modelContext } = await import('../src/application/autonomous.mjs');
  const context = await loadRun(options.out);
  const config = modelConfig({
    baseURL: 'https://example.com/v1',
    model: 'unused',
    contextFiles: ['src/App.vue']
  });
  const selected = await modelContext(context, {}, null, config);
  assert.ok(selected.files.some((f) => f.path === 'src/App.vue'));
  assert.ok(selected.files.some((f) => f.path === context.contract.target.module));
  assert.ok(selected.files.some((f) => f.path.startsWith(context.state.analysis.mount + '/')));
  assert.ok(selected.files.some((f) => f.path === 'test/catalog.test.mjs' && !f.editable));
  assert.ok(selected.contextSelection.omitted.includes('unrelated.json'));
  await assert.rejects(
    modelContext(context, {}, null, { ...config, contextFiles: undefined }),
    (e) => e.code === 'model_context_limit'
  );
  await assert.rejects(modelContext(context, {}, null, { ...config, contextFiles: ['../escape'] }), /Unsafe/);
  await assert.rejects(
    modelContext(context, {}, null, { ...config, contextFiles: ['missing.vue'] }),
    /ENOENT/
  );
});

test('autonomous preflight names a failed frozen build check and never calls the model', async (t) => {
  const env = await setup(t, async () => assert.fail('A failed baseline must not be sent to the model'));
  const contract = await readJson(env.options.contract);
  contract.checks = [
    { name: 'Production build', command: process.execPath, args: ['-e', 'process.exit(7)'] }
  ];
  await saveJson(env.options.contract, contract);
  const out = path.join(env.root, 'run-with-check');
  await prepare({ ...env.options, out });
  const result = await autoAdapt(out, { config: env.config, allowModel: true, allowExecution: true });
  assert.equal(result.status, 'preflight-failed');
  assert.equal(env.calls(), 0);
  assert.deepEqual(result.blockers, [{ stage: 'baseline-check', message: 'Production build: exit 7' }]);
});

test('unsupported dependency links fail before model transmission or repository execution', async (t) => {
  const env = await setup(t, async () => assert.fail('Unsupported dependency setup must not call the model'));
  const modules = path.join(env.root, 'dependency-store');
  await fs.mkdir(modules);
  await fs.symlink(modules, path.join(env.options.out, 'candidate/node_modules'));
  const result = await autoAdapt(env.options.out, {
    config: env.config,
    allowModel: true,
    allowExecution: true
  });
  assert.equal(result.status, 'preflight-failed');
  assert.equal(env.calls(), 0);
  assert.equal(result.blockers[0].stage, 'candidate-dependencies');
  assert.match(result.blockers[0].message, /real directory/);
  assert.equal((await fs.readdir(result.evidence)).includes('initial-verification.json'), false);
});

test('missing context is diagnosed before execution and consumes no proposal attempts', async (t) => {
  const env = await setup(t, async () => assert.fail('Invalid context must not reach provider'));
  const config = await readJson(env.config);
  await saveJson(env.config, { ...config, contextFiles: ['missing.vue'] });
  const result = await autoAdapt(env.options.out, {
    config: env.config,
    allowModel: true,
    allowExecution: true
  });
  assert.equal(result.status, 'preflight-failed');
  assert.equal(result.blockers[0].stage, 'model-context');
  assert.equal(result.attempts.length, 0);
  assert.equal(env.calls(), 0);
  assert.equal((await fs.readdir(result.evidence)).includes('initial-verification.json'), false);
});

test('autonomous repair refuses new declarations inside copied source and can recover outside it', async (t) => {
  const env = await setup(t, async ({ res, body, calls, proposal }) => {
    const c = JSON.parse(body.messages[1].content);
    assert.equal(c.integrationConstraints.newFilesInsideFeatureDirectory, false);
    if (calls === 1)
      reply(res, {
        edits: [
          {
            path: c.featureMount + '/bridge.d.mts',
            beforeSha256: null,
            content: 'export function bridge(value:unknown):boolean;'
          }
        ]
      });
    else {
      assert(c.previousProposalError);
      reply(res, proposal);
    }
  });
  const result = await autoAdapt(env.options.out, {
    config: env.config,
    allowModel: true,
    allowExecution: true,
    maxAttempts: 2
  });
  assert.equal(result.status, 'verified-for-contract');
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].status, 'rejected');
  await assert.rejects(fs.stat(path.join(env.options.out, 'candidate', env.options.mount, 'bridge.d.mts')));
});

test('autonomous proposals cannot turn type failures into passes with new suppression directives', async (t) => {
  const env = await setup(t, async ({ res, body, calls, proposal }) => {
    const c = JSON.parse(body.messages[1].content);
    if (calls === 1) {
      const edit = proposal.edits[0];
      reply(res, { edits: [{ ...edit, content: '// @ts-ignore bypass\n' + edit.content }] });
    } else {
      assert.equal(c.previousProposalError.code, 'type_check_suppression');
      reply(res, proposal);
    }
  });
  const result = await autoAdapt(env.options.out, {
    config: env.config,
    allowModel: true,
    allowExecution: true,
    maxAttempts: 2
  });
  assert.equal(result.status, 'verified-for-contract');
  assert.equal(result.attempts[0].status, 'rejected');
  assert(
    !(await fs.readFile(path.join(env.options.out, 'candidate/src/catalog.mjs'), 'utf8')).includes(
      '@ts-ignore'
    )
  );
});
