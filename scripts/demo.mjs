import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixture.mjs';
import { prepare, adapt, verify, exportPatch } from '../src/application/transfer.mjs';

const parent = path.join(process.cwd(), '.portsmith');
await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'demo-'));
const options = await fixture(root);
console.log('Portsmith: table-filtering feature → catalog app\n');
await prepare(options);
console.log('1. Traced 2 source files; preserved the MIT license.');
await adapt(options.out, path.join(root, 'proposal.json'));
console.log('2. Applied the included integration proposal to a destination copy.');
const report = await verify(options.out, { allowExecution: true });
for (const [label, value] of [
  ['Source contract', report.source],
  ['Destination before', report.baseline],
  ['Destination after', report.candidate]
]) {
  console.log(
    `3. ${label.padEnd(20)} ${value.cases?.filter((c) => c.status === 'passed').length ?? 0}/5 cases passed`
  );
}
if (report.status !== 'verified-for-contract')
  throw new Error(`Demo failed: ${report.status}. Inspect ${options.out}/verification.json`);
console.log('4. Existing destination tests pass before and after; originals unchanged.');
const result = await exportPatch(options.out);
console.log(
  `\nVerified for this contract. Patch checked with git apply --check.\n\nPatch:  ${result.patch}\nReport: ${options.out}/verification.json\n\nThe adaptation is an included proposal, not autonomous AI generation.`
);
