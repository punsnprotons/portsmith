// Executes trusted local application code in a fresh Chromium context per scenario.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { startApp } from './server.mjs';

const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).browser;
const output = process.argv[3];
let browser, app, result;
try {
  app = await startApp(process.cwd(), config);
  const executablePath = process.argv[4];
  if (!executablePath || !path.isAbsolute(executablePath))
    throw new Error('Missing resolved Chromium executable path.');
  browser = await chromium.launch({ headless: true, executablePath });
  const groups = {};
  for (const group of ['cases', 'regression']) {
    groups[group] = [];
    for (const [i, scenario] of config[group].entries()) {
      const context = await browser.newContext({
        serviceWorkers: 'block',
        acceptDownloads: false,
        viewport: { width: 1280, height: 800 }
      });
      await context.route('**/*', (route) =>
        new URL(route.request().url()).origin === app.origin
          ? route.continue()
          : route.abort('blockedbyclient')
      );
      await context.routeWebSocket('**/*', (ws) => ws.close());
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('requestfailed', (req) => errors.push(`Request failed: ${req.url()}`));
      page.on('response', (res) => {
        if (res.status() >= 400) errors.push(`HTTP ${res.status()}: ${res.url()}`);
      });
      const record = {
        name: scenario.name,
        status: 'passed',
        assertions: [],
        screenshot: `${group}-${i}.png`,
        trace: `${group}-${i}.zip`
      };
      page.setDefaultTimeout(config.actionTimeoutMs);
      try {
        const response = await page.goto(`${app.origin}/${config.page}`, {
          waitUntil: 'load',
          timeout: 15000
        });
        if (!response?.ok()) throw new Error('Page did not load successfully');
        for (const step of scenario.steps) {
          const locator = page.locator(step.selector);
          if (step.action === 'fill') await locator.fill(step.value);
          else if (step.action === 'click') await locator.click();
          else if (step.action === 'press') await locator.press(step.key);
          else await locator.setChecked(step.checked);
        }
        for (const assertion of scenario.assertions) {
          const locator = page.locator(assertion.selector);
          try {
            const options = { timeout: config.actionTimeoutMs };
            if (assertion.kind === 'text') await expect(locator).toHaveText(assertion.expected, options);
            else if (assertion.kind === 'count')
              await expect(locator).toHaveCount(assertion.expected, options);
            else if (assertion.kind === 'value')
              await expect(locator).toHaveValue(assertion.expected, options);
            else if (assertion.expected) await expect(locator).toBeVisible(options);
            else await expect(locator).not.toBeVisible(options);
            record.assertions.push({ ...assertion, status: 'passed' });
          } catch (error) {
            // Invalid selectors/strict-mode failures are errors, not evidence of a missing feature.
            if (!error.matcherResult) throw error;
            record.status = 'mismatch';
            record.assertions.push({ ...assertion, status: 'mismatch', error: error.message.slice(0, 4000) });
          }
        }
        if (errors.length) throw new Error(errors.join('\n').slice(0, 8000));
      } catch (error) {
        record.status = 'error';
        record.error = String(error.message).slice(0, 8000);
      }
      try {
        await page.screenshot({ path: path.join(output, record.screenshot), fullPage: false });
        await context.tracing.stop({ path: path.join(output, record.trace) });
      } catch (error) {
        record.status = 'error';
        record.error = `Browser evidence capture failed: ${error.message}`;
      } finally {
        await context.close();
      }
      if (errors.length) {
        record.status = 'error';
        record.error = errors.join('\n').slice(0, 8000);
      }
      groups[group].push(record);
    }
  }
  result = {
    status: Object.values(groups)
      .flat()
      .every((c) => c.status === 'passed')
      ? 'passed'
      : 'failed',
    ...groups,
    browser: browser.version()
  };
} catch (error) {
  result = { status: 'error', error: String(error.message).slice(0, 8000), cases: [], regression: [] };
} finally {
  await browser?.close();
  await app?.close();
}
fs.writeSync(3, JSON.stringify(result));
