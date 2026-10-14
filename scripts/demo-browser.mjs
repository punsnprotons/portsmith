import fs from 'node:fs/promises';
import path from 'node:path';
import { browserFixture } from './browser-fixture.mjs';
import { project } from './fixture.mjs';
import { prepare, adapt, verify, exportPatch } from '../src/index.mjs';
await fs.mkdir(path.join(project, '.portsmith'), { recursive: true });
const root = await fs.mkdtemp(path.join(project, '.portsmith', 'browser-demo-'));
const options = await browserFixture(root);
await prepare(options);
await adapt(options.out, path.join(root, 'proposal.json'));
const report = await verify(options.out, { allowExecution: true, timeoutMs: 30000 });
if (report.status !== 'verified-for-contract')
  throw new Error(`Browser verification failed. Inspect ${options.out}/verification.json`);
console.log(
  JSON.stringify(
    {
      status: report.status,
      browser: report.browser.status,
      patch: await exportPatch(options.out),
      report: path.join(options.out, 'verification.json')
    },
    null,
    2
  )
);
