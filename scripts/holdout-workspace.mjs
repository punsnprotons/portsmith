import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runProcess } from '../src/platform/process.mjs';
import { inventory, same, saveJson } from '../src/platform/files.mjs';
const run = path.resolve(process.argv[2]),
  output = path.resolve(process.argv[3]);
await fs.mkdir(output, { recursive: true });
let seed = 718239;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
const cases = [];
for (let i = 0; i < 100; i++) {
  const v = {
    code: 'flowchart LR\nA[注文' + random() + '] --> B[📦]',
    mermaid: JSON.stringify({
      theme: ['default', 'dark', 'forest'][random() % 3],
      flowchart: { curve: 'basis' }
    }),
    pan: { x: (random() % 200) - 100, y: random() % 200 },
    zoom: (random() % 100) / 10,
    grid: !!(random() % 2),
    future: { id: random(), list: [null, true, 'é'] }
  };
  for (const [kind, value, expected] of [
    ['valid future state', v, true],
    ['bad pan', { ...v, pan: { x: v.pan.x, y: null } }, false],
    ['primitive config', { ...v, mermaid: ['true', '7', '"text"'][random() % 3] }, false],
    ['bad flag', { ...v, panZoom: random() }, false],
    ['bad code', { ...v, code: { nested: 'text' } }, false]
  ])
    cases.push({ kind, value, expected });
}
await saveJson(path.join(output, 'cases.json'), cases);
const runner = path.join(output, 'runner.mjs');
await fs.writeFile(
  runner,
  `import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import{pathToFileURL}from'node:url';import{deflateSync}from'node:zlib';const side=process.argv[2],cases=JSON.parse(await fs.readFile(process.argv[3]));const{isValidSharedState}=await import(pathToFileURL(path.resolve(side==='source'?'portsmith-state.mjs':'src/lib/util/stateValidation.ts')));const serde=side==='source'?null:await import(pathToFileURL(path.resolve('src/lib/util/serde.ts')));const failures=[],serdeFailures=[];for(const[i,c]of cases.entries()){const before=JSON.stringify(c.value);const actual=isValidSharedState(c.value);if(actual!==c.expected||JSON.stringify(c.value)!==before)failures.push({i,kind:c.kind,actual});if(serde)for(const type of ['base64','pako']){const bytes=Buffer.from(before);const input=type+':'+(type==='pako'?deflateSync(bytes):bytes).toString('base64url');try{const value=serde.deserializeState(input);if(!c.expected)serdeFailures.push({i,type,error:'invalid accepted'});else assert.deepEqual(value,c.value);}catch(e){if(c.expected)serdeFailures.push({i,type,error:e.message});}}}console.log(JSON.stringify({total:cases.length,passed:cases.length-failures.length,failures,serde:serde?{total:cases.length*2,passed:cases.length*2-serdeFailures.length,failures:serdeFailures}:null}));`
);
const results = [];
for (const side of ['source', 'baseline', 'candidate']) {
  const cwd = path.join(run, side),
    before = await inventory(cwd);
  const r = await runProcess(
    process.execPath,
    [
      '--experimental-transform-types',
      '--import',
      path.resolve('src/providers/node/register-aliases.mjs'),
      runner,
      side,
      path.join(output, 'cases.json')
    ],
    { cwd, timeoutMs: 30000, maxOutputBytes: 2000000 }
  );
  assert.equal(r.exitCode, 0, r.stderr || r.reason);
  assert.equal(r.reason, null);
  const result = { side, ...JSON.parse(r.stdout), inventoryUnchanged: same(before, await inventory(cwd)) };
  results.push(result);
  await saveJson(path.join(output, 'results.json'), {
    seed: 718239,
    scope:
      '500 generated cases hidden from proposals, plus both actual share decoders and unchanged future-field payloads.',
    results
  });
  assert(result.inventoryUnchanged);
  if (side === 'baseline') assert(result.passed < result.total);
  else {
    assert.equal(result.passed, result.total);
    if (result.serde) assert.equal(result.serde.passed, result.serde.total);
  }
}
console.log(
  results.map(({ side, total, passed, serde }) => ({
    side,
    total,
    passed,
    serde: serde && { total: serde.total, passed: serde.passed }
  }))
);
