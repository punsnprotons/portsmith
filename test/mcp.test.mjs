import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture, project } from '../scripts/fixture.mjs';

test('MCP client can discover, inspect and prepare; execution tools are absent and outside paths rejected', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-mcp-'));
  const options = await fixture(root);
  const client = new Client({ name: 'portsmith-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(project, 'src/mcp.mjs'), '--root', root],
    stderr: 'pipe'
  });
  t.after(async () => {
    await client.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await client.connect(transport);
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 15);
  assert.ok(listed.tools.some((tool) => tool.name === 'adapt_transfer'));
  assert.ok(listed.tools.some((tool) => tool.name === 'export_transfer'));
  assert.ok(!listed.tools.some((tool) => tool.name === 'verify_transfer'));
  const discovered = await client.callTool({
    name: 'discover_features',
    arguments: { source: options.source }
  });
  assert.equal(discovered.isError, undefined);
  assert(discovered.structuredContent.candidates.length > 0);
  const guided = await client.getPrompt({
    name: 'transfer_feature',
    arguments: { source: options.source, target: options.target, query: 'filter' }
  });
  assert.match(guided.messages[0].content.text, /discover_features/);
  const inspected = await client.callTool({
    name: 'inspect_feature',
    arguments: { source: options.source, target: options.target, entry: options.entry }
  });
  assert.equal(inspected.isError, undefined);
  assert.equal(inspected.structuredContent.files.length, 2);
  const prepared = await client.callTool({ name: 'prepare_transfer', arguments: options });
  assert.equal(prepared.isError, undefined, JSON.stringify(prepared));
  assert.equal(prepared.structuredContent.status, 'prepared');
  const state = await client.callTool({ name: 'inspect_transfer', arguments: { run: options.out } });
  assert.equal(state.structuredContent.verification, null);
  const escaped = await client.callTool({
    name: 'inspect_feature',
    arguments: { source: project, target: options.target, entry: 'src/cli.mjs' }
  });
  assert.equal(escaped.isError, true);
  assert.match(escaped.content[0].text, /configured MCP root/);
});

test('execution-enabled MCP completes an authorized transfer, exposes guidance and rejects an unauthorized call', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-mcp-execute-'));
  const options = await fixture(root);
  const client = new Client({ name: 'portsmith-execution-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(project, 'src/mcp.mjs'), '--root', root, '--allow-execution'],
    stderr: 'pipe'
  });
  t.after(async () => {
    await client.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 21);
  assert.equal((await client.listPrompts()).prompts[0].name, 'transfer_feature');
  const call = (name, args) => client.callTool({ name, arguments: args });
  assert.equal((await call('prepare_transfer', options)).structuredContent.status, 'prepared');
  const denied = await call('verify_transfer', { run: options.out });
  assert.equal(denied.isError, true);
  assert.equal(JSON.parse(denied.content[0].text).error.code, 'execution_not_authorized');
  assert.equal(
    (await call('adapt_transfer', { run: options.out, proposal: path.join(root, 'proposal.json') }))
      .structuredContent.status,
    'adapted'
  );
  assert.equal(
    (await call('verify_transfer', { run: options.out, allowExecution: true })).structuredContent.status,
    'verified-for-contract'
  );
  assert.equal((await call('export_transfer', { run: options.out })).structuredContent.status, 'patch-ready');
  assert.equal(
    (await call('transfer_report', { run: options.out })).structuredContent.behavior.candidate.passed,
    5
  );
});
