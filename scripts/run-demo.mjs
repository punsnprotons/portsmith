#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

try {
  const { values } = parseArgs({
    options: {
      browser: { type: 'boolean' },
      'install-browser': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: false
  });
  if (values.help) {
    console.log(`portsmith-demo [--browser] [--install-browser]
Runs the included authored transfer in a fresh .portsmith directory under your current folder.
No API key is needed. --browser adds Chromium interaction checks.
--install-browser downloads the package's matching Chromium and runs the browser demo.`);
  } else {
    if (values['install-browser']) {
      const require = createRequire(import.meta.url);
      const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
      const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
      if (result.error) throw result.error;
      if (result.status !== 0) throw Error('Chromium installation failed; the demo was not run.');
    }
    await import(values.browser || values['install-browser'] ? './demo-browser.mjs' : './demo.mjs');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
