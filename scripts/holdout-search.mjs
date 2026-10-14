import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runProcess } from '../src/platform/process.mjs';
import { inventory, same, saveJson } from '../src/platform/files.mjs';
const run = path.resolve(process.argv[2]),
  output = path.resolve(process.argv[3]);
await fs.mkdir(output, { recursive: true });
let seed = 1729;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed;
};
const cases = [];
for (let i = 0; i < 100; i++) {
  const label = Array.from({ length: 18 }, () => String.fromCharCode(97 + (random() % 20))).join('');
  for (const [kind, query, expected] of [
    ['exact', label, true],
    ['delete', label.slice(0, 5) + label.slice(6), true],
    ['insert', label.slice(0, 5) + 'z' + label.slice(5), true],
    ['replace', label.slice(0, 5) + 'z' + label.slice(6), true],
    ['unrelated', 'z'.repeat(18), false]
  ])
    cases.push({ kind, query, node: { label }, expected });
}
await saveJson(path.join(output, 'cases.json'), cases);
const runner = path.join(output, 'runner.mjs');
await fs.writeFile(
  runner,
  `import fs from 'node:fs/promises';import {pathToFileURL} from 'node:url';import path from 'node:path';\nconst {matchTreeNode}=await import(pathToFileURL(path.resolve(process.argv[2])));const cases=JSON.parse(await fs.readFile(process.argv[3]));const failures=[];for(const [i,c] of cases.entries()){const before=JSON.stringify(c.node);const actual=matchTreeNode(c.query,c.node);if(actual!==c.expected||JSON.stringify(c.node)!==before) failures.push({i,...c,actual});}console.log(JSON.stringify({total:cases.length,passed:cases.length-failures.length,failures}));\n`
);
const results = [];
for (const side of ['source', 'baseline', 'candidate']) {
  const cwd = path.join(run, side),
    before = await inventory(cwd);
  const r = await runProcess(
    process.execPath,
    [
      '--import',
      path.resolve('src/providers/node/register-relative.mjs'),
      runner,
      side === 'source' ? 'portsmith-search.mjs' : 'src/utils/tableSearch.js',
      path.join(output, 'cases.json')
    ],
    { cwd, timeoutMs: 30000 }
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(r.reason, null);
  const result = { side, ...JSON.parse(r.stdout), inventoryUnchanged: same(before, await inventory(cwd)) };
  results.push(result);
  assert(result.inventoryUnchanged);
  if (side === 'baseline') assert(result.passed < result.total);
  else assert.equal(result.passed, result.total);
}
await saveJson(path.join(output, 'results.json'), {
  seed: 1729,
  scope:
    'Independent expected booleans for exact, single-edit and unrelated queries; no model access to these cases.',
  results
});
console.log(results.map(({ side, total, passed }) => ({ side, total, passed })));
