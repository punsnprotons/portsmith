import path from 'node:path';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { startApp } from '../src/providers/browser/server.mjs';
import { runProcess } from '../src/platform/process.mjs';
import { saveJson } from '../src/platform/files.mjs';
const run = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
await fs.mkdir(output, { recursive: true });
const sides = process.argv.includes('--inspect') ? ['baseline'] : ['baseline', 'candidate'];
for (const side of sides) {
  const app = await startApp(path.join(run, side), {
    page: 'edit',
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
  try {
    const r = await runProcess(
      path.resolve('.portsmith/browser-python/bin/python'),
      [
        path.resolve('scripts/browser-workspace.py'),
        '--url',
        app.origin,
        '--executable',
        chromium.executablePath(),
        '--output',
        output,
        '--side',
        side,
        ...(process.argv.includes('--inspect') ? ['--inspect'] : [])
      ],
      { timeoutMs: 120000 }
    );
    await saveJson(path.join(output, side + '-execution.json'), r);
    console.log(side, r.exitCode, r.stdout, r.stderr);
    if (r.exitCode !== 0 || r.reason) throw Error('Browser failed: ' + side);
  } finally {
    await app.close();
  }
}
