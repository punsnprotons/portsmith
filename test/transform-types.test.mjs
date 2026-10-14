import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fixture } from '../scripts/fixture.mjs';
import { prepare, adapt, verify, exportPatch } from '../src/index.mjs';
import { readJson, saveJson, hash } from '../src/platform/files.mjs';
test('explicit TypeScript transformation runs enums in contracts and Node regressions without bypassing failures', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-transform-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = await fixture(root),
    contract = await readJson(options.contract);
  const enumText = 'export enum Mode { Safe = "safe" }\n';
  for (const side of ['source', 'target']) {
    await fs.writeFile(path.join(options[side], 'mode.ts'), enumText);
    const file = path.join(options[side], side === 'source' ? options.entry : 'src/catalog.mjs');
    await fs.writeFile(
      file,
      "import {Mode} from '../mode.ts'; if(Mode.Safe!=='safe')throw Error('bad transform');\n" +
        (await fs.readFile(file, 'utf8'))
    );
  }
  await fs.writeFile(
    path.join(options.target, 'test/enum.test.mjs'),
    "import {test} from 'node:test';import assert from 'node:assert/strict';import {Mode} from '../mode.ts';test('enum runtime',()=>assert.equal(Mode.Safe,'safe'));\n"
  );
  contract.regression.args.push('test/enum.test.mjs');
  const proposal = await readJson(path.join(root, 'proposal.json'));
  proposal.edits[0].beforeSha256 = hash(await fs.readFile(path.join(options.target, 'src/catalog.mjs')));
  proposal.edits[0].content =
    "import {Mode} from '../mode.ts'; if(Mode.Safe!=='safe')throw Error('bad transform');\n" +
    proposal.edits[0].content;
  await saveJson(path.join(root, 'proposal.json'), proposal);
  contract.runtime = { transformTypes: true };
  await saveJson(options.contract, contract);
  await prepare(options);
  await adapt(options.out, path.join(root, 'proposal.json'));
  const report = await verify(options.out, { allowExecution: true });
  assert.equal(report.status, 'verified-for-contract', JSON.stringify(report));
  assert.equal(report.version, 8);
  assert.equal(report.regression.candidate.status, 'passed');
  await exportPatch(options.out);
  // A fresh frozen run without the flag must fail closed on the same non-erasable syntax.
  delete contract.runtime;
  await saveJson(options.contract, contract);
  options.out = path.join(root, 'without-transform');
  await prepare(options);
  await adapt(options.out, path.join(root, 'proposal.json'));
  const failed = await verify(options.out, { allowExecution: true });
  assert.notEqual(failed.status, 'verified-for-contract');
  assert.equal(failed.source.status, 'error');
  await assert.rejects(exportPatch(options.out));
});
