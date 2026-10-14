import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { inventory, hash } from '../src/platform/files.mjs';
const { values } = parseArgs({
  options: { case: { type: 'string' }, run: { type: 'string' }, output: { type: 'string' } }
});
const name = values.case;
if (!['drawdb', 'mermaid-live-editor'].includes(name))
  throw Error('Select --case drawdb|mermaid-live-editor');
const base = path.resolve('.portsmith/complex-bench');
const setup = values.run
  ? { run: path.resolve(values.run) }
  : JSON.parse(await fs.readFile(path.join(base, `${name}-latest.json`)));
const candidate = path.join(setup.run, 'candidate');
const source = path.join(base, 'repos', name === 'drawdb' ? 'dequal' : 'fast-json-stable-stringify');
const out = values.output ? path.resolve(values.output) : path.join(base, `${name}-holdout.json`);
if (name === 'drawdb') await import('../src/providers/node/register-relative.mjs');

let count = 0;
if (name === 'drawdb') {
  const { dequal } = await import(pathToFileURL(source + '/src/index.js'));
  const { arrayIsEqual } = await import(pathToFileURL(candidate + '/src/utils/utils.js'));
  for (let i = 0; i < 300; i++) {
    const a = [
      {
        id: i,
        meta: { name: `table_${i}_😀`, nullable: i % 2 === 0 },
        fields: [{ id: i + 1, type: 'VARCHAR', size: i % 255 }]
      }
    ];
    const b = [
      {
        fields: [{ size: i % 255, type: 'VARCHAR', id: i + 1 }],
        meta: { nullable: i % 2 === 0, name: `table_${i}_😀` },
        id: i
      }
    ];
    assert.equal(arrayIsEqual(a, b), true);
    assert.equal(arrayIsEqual(a, b), dequal(a, b));
    count++;
    b[0].fields[0].size++;
    assert.equal(arrayIsEqual(a, b), false);
    assert.equal(arrayIsEqual(a, b), dequal(a, b));
    count++;
  }
} else {
  const { default: stable } = await import(pathToFileURL(source + '/index.js'));
  const { serializedJSON } = await import(pathToFileURL(candidate + '/test/portsmith-boundary.mjs'));
  const { serializeState, deserializeState } = await import(
    pathToFileURL(candidate + '/src/lib/util/serde.ts')
  );
  for (let i = 0; i < 300; i++) {
    const a = JSON.parse(
      JSON.stringify({
        rough: i % 2 === 0,
        code: `flowchart TD\nA["café ${i}"]-->B`,
        pan: { y: -i, x: i + 0.25 },
        mermaid: JSON.stringify({ theme: 'default' }),
        grid: false
      })
    );
    const b = { grid: false, mermaid: a.mermaid, pan: { x: i + 0.25, y: -i }, code: a.code, rough: a.rough };
    for (const serde of ['base64', 'pako']) {
      assert.equal(serializedJSON(a, serde), stable(a));
      assert.equal(serializeState(a, serde), serializeState(b, serde));
      assert.deepEqual(deserializeState(serializeState(a, serde)), a);
      count++;
    }
  }
}
await fs.writeFile(
  out,
  JSON.stringify(
    {
      name,
      status: 'passed',
      candidateInventorySha256: hash(JSON.stringify(await inventory(candidate))),
      sourceInventorySha256: hash(JSON.stringify(await inventory(source))),
      generatedCases: count,
      seed: 'deterministic integer sequence 0..299',
      checks:
        name === 'drawdb'
          ? 'structural equality and changed leaves; pinned source agreement'
          : 'canonical JSON, equal links across key orders, round trips; both codecs'
    },
    null,
    2
  )
);
console.log({ name, count });
