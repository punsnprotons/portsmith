import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runProcess } from '../src/platform/process.mjs';
import { inventory, same, saveJson } from '../src/platform/files.mjs';
const run = path.resolve(process.argv[2]),
  output = path.resolve(process.argv[3]);
await fs.mkdir(output, { recursive: true });
let seed = 81721;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed;
};
const cases = [];
for (let i = 0; i < 100; i++) {
  const word = Array.from({ length: 18 }, () => String.fromCharCode(97 + (random() % 20))).join('');
  const docs = [
    { id: 'a', title: word, body: 'warehouse inventory' },
    { id: 'b', title: 'zzzzzzzzzzzzzzzzzz', body: 'unrelated' }
  ];
  const typo = word.slice(0, 5) + word.slice(6);
  for (const [kind, operations, expected] of [
    ['fuzzy cross-field', [{ type: 'search', query: typo + ' invent' }], [['a']]],
    [
      'replace',
      [
        { type: 'replace', document: { id: 'a', title: 'shipments', body: 'dispatch' } },
        { type: 'search', query: word },
        { type: 'search', query: 'ship dispatch' }
      ],
      [[], ['a']]
    ],
    [
      'remove',
      [
        { type: 'remove', id: 'a' },
        { type: 'search', query: word },
        { type: 'search', query: '' }
      ],
      [[], ['b']]
    ],
    [
      'add',
      [
        { type: 'add', document: { id: 'c', title: word, body: 'account balance' } },
        { type: 'search', query: typo + ' balance' }
      ],
      [['c']]
    ],
    [
      'reuse',
      [
        { type: 'remove', id: 'a' },
        { type: 'add', document: { id: 'a', title: 'products', body: 'stock' } },
        { type: 'search', query: word },
        { type: 'search', query: 'prod stock' }
      ],
      [[], ['a']]
    ]
  ])
    cases.push({ kind, docs, operations, expected });
}
await saveJson(path.join(output, 'cases.json'), cases);
const runner = path.join(output, 'runner.mjs');
await fs.writeFile(
  runner,
  `import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';const {searchSequence}=await import(pathToFileURL(path.resolve(process.argv[2])));const cases=JSON.parse(await fs.readFile(process.argv[3]));const failures=[];for(const [i,c]of cases.entries()){const before=JSON.stringify(c);const actual=searchSequence(c.docs,c.operations);if(JSON.stringify(actual)!==JSON.stringify(c.expected)||JSON.stringify(c)!==before)failures.push({i,...c,actual});}console.log(JSON.stringify({total:cases.length,passed:cases.length-failures.length,failures}));`
);
const results = [];
for (const side of ['source', 'baseline', 'candidate']) {
  const cwd = path.join(run, side),
    before = await inventory(cwd);
  const r = await runProcess(
    process.execPath,
    [
      '--import',
      path.resolve('src/providers/node/register-aliases.mjs'),
      runner,
      side === 'source' ? 'portsmith-index.mjs' : 'src/utils/indexSearch.js',
      path.join(output, 'cases.json')
    ],
    { cwd, timeoutMs: 30000, maxOutputBytes: 2000000 }
  );
  assert.equal(r.exitCode, 0, r.stderr || r.reason);
  assert.equal(r.reason, null);
  const result = { side, ...JSON.parse(r.stdout), inventoryUnchanged: same(before, await inventory(cwd)) };
  results.push(result);
  await saveJson(path.join(output, 'results.json'), {
    seed: 81721,
    scope:
      '500 stateful sequences over unseen seeded words. Expected IDs authored independently; hidden from both model proposals.',
    results
  });
  assert(result.inventoryUnchanged);
  if (side === 'baseline') assert(result.passed < result.total);
  else assert.equal(result.passed, result.total);
}
console.log(results.map(({ side, total, passed }) => ({ side, total, passed })));
