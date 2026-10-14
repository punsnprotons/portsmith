// Supplemental production interactions; independent of callable verification status.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { inflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from 'playwright/test';
import { startApp } from '../src/providers/browser/server.mjs';
import { readJson, saveJson, hash, inventory } from '../src/platform/files.mjs';
const { values } = parseArgs({
  options: {
    case: { type: 'string' },
    network: { type: 'string', default: 'local' },
    run: { type: 'string' },
    output: { type: 'string' }
  }
});
const name = values.case;
const network = values.network;
if (!['local', 'online'].includes(network)) throw Error('Select local|online network');
if (!['drawdb', 'mermaid-live-editor'].includes(name)) throw Error('Select benchmark case');
const base = path.resolve('.portsmith/complex-bench');
const root = values.run
  ? path.resolve(values.run)
  : (await readJson(path.join(base, `${name}-replay-latest.json`))).root;
const output = values.output ? path.resolve(values.output) : base;
await fs.mkdir(output, { recursive: true });
const folder = await fs.mkdtemp(path.join(output, `${name}-browser-`));
const results = [];
for (const side of ['baseline', 'candidate']) {
  const cwd = path.join(root, side),
    pagePath = name === 'drawdb' ? 'editor' : 'edit';
  const app = await startApp(cwd, {
    page: pagePath,
    server: {
      command: process.execPath,
      args: [
        'node_modules/vite/bin/vite.js',
        'preview',
        '--host',
        '127.0.0.1',
        '--port',
        '{port}',
        '--strictPort'
      ]
    }
  });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block'
  });
  if (network === 'local')
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === app.origin ? route.continue() : route.abort()
    );
  await context.routeWebSocket('**/*', (ws) => ws.close());
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await context.newPage(),
    errors = [],
    steps = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push('request failed ' + r.url()));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  const record = {
    side,
    network,
    status: 'passed',
    steps,
    errors,
    inventorySha256: hash(JSON.stringify(await inventory(cwd)))
  };
  try {
    await page.goto(app.origin + '/' + pagePath, { waitUntil: 'load' });
    if (name === 'drawdb') {
      await page.getByText('PostgreSQL', { exact: true }).click();
      await page.locator('button[aria-label="confirm"]').click();
      await page.locator('button').filter({ hasText: 'Add table' }).click();
      await page
        .getByText(/^table_/)
        .first()
        .click();
      await page.locator('input[placeholder="Name"]').nth(0).fill('customers');
      await page.locator('input[placeholder="Name"]').nth(0).press('Tab');
      await expect(page.getByText('Tables (1)', { exact: true })).toBeVisible();
      steps.push('choose PostgreSQL, create and rename a table');
      await page.locator('button').filter({ hasText: 'Add column' }).click();
      await page.locator('input[placeholder="Name"]').nth(2).fill('account_id');
      await page.locator('input[placeholder="Name"]').nth(2).press('Tab');
      await expect(page.getByText('account_id', { exact: true }).last()).toBeVisible();
      await page.getByText('Type', { exact: true }).click();
      await page.locator('.semi-select input').last().fill('INTEGER');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(page.getByText('Type', { exact: true })).toHaveCount(0);
      await expect(page.locator('.semi-select-option-list')).toHaveCount(0);
      steps.push('add and rename a real schema column, then choose INTEGER');
      await page.screenshot({ path: path.join(folder, side + '.png') });
      const savedUrl = page.url();
      assert.match(savedUrl, /\/editor\/diagrams\//);
      // Use the app's save command and wait for its completion before reload.
      await page.keyboard.press('ControlOrMeta+s');
      await expect(page.getByText(/Last saved/)).toBeVisible();
      await page.reload({ waitUntil: 'load' });
      await expect(page.getByText('customers', { exact: true }).last()).toBeVisible();
      await expect(page.getByText('account_id', { exact: true }).last()).toBeVisible();
      await page.getByText('Problems', { exact: true }).click();
      await expect(page.getByText('No problems were detected.', { exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(folder, side + '-persisted.png') });
      steps.push('reload saved diagram and confirm there are no schema problems');
    } else {
      const code = 'flowchart LR\nA[Customer] --> B[Invoice]';
      await page.locator('.monaco-editor').first().click();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.insertText(code);
      await expect(page.locator('svg .nodeLabel').filter({ hasText: 'Customer' })).toBeVisible();
      await expect(page.locator('svg .nodeLabel').filter({ hasText: 'Invoice' })).toBeVisible();
      const decoded = (url) =>
        inflateSync(Buffer.from(new URL(url).hash.slice('#pako:'.length), 'base64url')).toString('utf8');
      await expect
        .poll(
          () => {
            try {
              return JSON.parse(decoded(page.url())).code;
            } catch {
              return '';
            }
          },
          { timeout: 15000 }
        )
        .toBe(code);
      steps.push('type a two-node diagram and observe both rendered SVG labels');
      await page.getByRole('button', { name: 'Share', exact: true }).click();
      const link = await page.locator('input[type="url"]').inputValue();
      assert.equal(JSON.parse(decoded(link)).code, code);
      const { default: stable } = await import(
        pathToFileURL(path.join(base, 'repos/fast-json-stable-stringify/index.js'))
      );
      record.shareLinkUsesCanonicalJSON = decoded(link) === stable(JSON.parse(decoded(link)));
      if (side === 'candidate') assert.equal(record.shareLinkUsesCanonicalJSON, true);
      steps.push('Share dialog contains the edited diagram; inspect actual encoded state');
      await page.screenshot({ path: path.join(folder, side + '.png') });
      const isolated = await browser.newContext({ serviceWorkers: 'block' });
      if (network === 'local')
        await isolated.route('**/*', (r) =>
          new URL(r.request().url()).origin === app.origin ? r.continue() : r.abort()
        );
      const shared = await isolated.newPage();
      shared.on('pageerror', (e) => errors.push(e.message));
      shared.on('requestfailed', (r) => errors.push('shared request failed ' + r.url()));
      shared.on('response', (r) => {
        if (r.status() >= 400) errors.push(`shared HTTP ${r.status()} ${r.url()}`);
      });
      await shared.goto(link, { waitUntil: 'load' });
      await expect(shared.locator('svg .nodeLabel').filter({ hasText: 'Customer' })).toBeVisible({
        timeout: 15000
      });
      await expect(shared.locator('svg .nodeLabel').filter({ hasText: 'Invoice' })).toBeVisible();
      await shared.screenshot({ path: path.join(folder, side + '-shared.png') });
      await isolated.close();
      steps.push('open the share link in a fresh browser context and reproduce the diagram');
    }
    assert.deepEqual(errors, []);
  } catch (e) {
    record.status = 'failed';
    record.error = e.message;
    await page.screenshot({ path: path.join(folder, side + '-failure.png') }).catch(() => {});
  } finally {
    await context.tracing.stop({ path: path.join(folder, side + '.zip') });
    await browser.close();
    await app.close();
  }
  record.artifacts = {};
  for (const file of await fs.readdir(folder))
    if (file.startsWith(side)) record.artifacts[file] = hash(await fs.readFile(path.join(folder, file)));
  results.push(record);
  await saveJson(path.join(folder, 'result.json'), { name, root, results });
}
await saveJson(path.join(output, `${name}-browser-latest.json`), {
  folder,
  status: results.every((r) => r.status === 'passed') ? 'passed' : 'failed',
  results
});
console.log(JSON.stringify({ folder, results }, null, 2));
if (results.some((r) => r.status !== 'passed')) process.exitCode = 1;
