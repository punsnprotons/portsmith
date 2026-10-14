import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixture.mjs';

// Generate inputs only: the user runs each transfer step from the walkthrough.
const parent = path.join(process.cwd(), '.portsmith');
await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'learn-'));
await fixture(root);
const quoted = `'${root.replaceAll("'", "'\\''")}'`;
console.log(
  `Example ready. Source, destination, contract and authored proposal are in:\n${root}\n\nCopy this into your shell, then follow docs/first-transfer.md:\n\nexport PORTSMITH_EXAMPLE=${quoted}\n\nNo repository code has been executed. No run has been prepared yet.`
);
