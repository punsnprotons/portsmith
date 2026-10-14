// Explicitly authorized app benchmarks; setup helpers are frozen test code, not integrations.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { prepare, autoAdapt } from '../src/index.mjs';
import { inventory, saveJson, readJson } from '../src/platform/files.mjs';
const { values } = parseArgs({
  options: { case: { type: 'string' }, mode: { type: 'string', default: 'prepare' } }
});
const name = values.case;
if (!['drawdb', 'mermaid-live-editor'].includes(name)) throw Error('--case drawdb|mermaid-live-editor');
const base = path.resolve('.portsmith/complex-bench');
if (values.mode === 'run') {
  const setup = await readJson(path.join(base, `${name}-latest.json`));
  const result = await autoAdapt(setup.run, {
    config: setup.config,
    allowModel: true,
    allowExecution: true,
    maxAttempts: 3,
    timeoutMs: 120000
  });
  await saveJson(path.join(setup.folder, 'result.json'), result);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'verified-for-contract') process.exitCode = 1;
} else if (values.mode === 'prepare') {
  const target = path.join(base, 'targets', name);
  await fs.mkdir(path.join(target, 'test'), { recursive: true });
  let contract, source, entry, mount, contextFiles;
  if (name === 'drawdb') {
    source = path.join(base, 'repos/dequal');
    entry = 'src/index.js';
    mount = 'src/features/dequal';
    const samples = [
      ['empty', [], [], true],
      ['same primitives', [1, 'x', null], [1, 'x', null], true],
      ['order matters', [1, 2], [2, 1], false],
      ['different length', [1], [1, 2], false],
      ['object key order', [{ id: 1, name: 'users' }], [{ name: 'users', id: 1 }], true],
      ['nested key order', [{ a: { x: 1, y: 2 }, b: 3 }], [{ b: 3, a: { y: 2, x: 1 } }], true],
      ['value change', [{ a: 1 }], [{ a: 2 }], false],
      ['missing key', [{ a: null }], [{}], false],
      ['type matters', [1], ['1'], false],
      ['unicode', [{ label: '😀', id: 2 }], [{ id: 2, label: '😀' }], true],
      ['nested array order', [{ a: [1, 2] }], [{ a: [2, 1] }], false],
      ['mixed', [null, { z: [{ b: 2, a: 1 }] }], [null, { z: [{ a: 1, b: 2 }] }], true]
    ];
    await fs.writeFile(
      path.join(target, 'test/portsmith-regression.test.mjs'),
      `import {test} from 'node:test';
import assert from 'node:assert/strict';
import {arrayIsEqual,strHasQuotes,isKeyword,isFunction,clampTableWidth,getRelationshipFields,getVisibleFields,getTableWidth} from '../src/utils/utils.js';
import {getRectFromEndpoints,isInsideRect,cascadePosition} from '../src/utils/rect.js';
import {deepDiff} from '../src/utils/diff.js';
test('unchanged issue lists',()=>assert.equal(arrayIsEqual([{id:1}],[{id:1}]),true));
test('changed issue lists',()=>assert.equal(arrayIsEqual([{id:1}],[{id:2}]),false));
test('SQL quotes',()=>{for(const q of ["'",'"','\x60'])assert.equal(strHasQuotes(q+'x'+q),true);assert.equal(strHasQuotes('x'),false)});
test('SQL keywords',()=>{assert.equal(isKeyword('current_timestamp'),true);assert.equal(isKeyword('users'),false)});
test('SQL functions',()=>{assert.equal(isFunction('COUNT(*)'),true);assert.equal(isFunction('name'),false)});
test('table width clamps',()=>{assert.equal(clampTableWidth(0),180);assert.equal(clampTableWidth(999),480);assert.equal(clampTableWidth(250.7),251)});
test('default and custom width',()=>{assert.equal(getTableWidth({}),220);assert.equal(getTableWidth({width:300}),300)});
test('legacy relationship fields',()=>assert.deepEqual(getRelationshipFields({startFieldId:1,endFieldId:2}),[{startFieldId:1,endFieldId:2}]));
test('collapsed fields preserve relationships',()=>{const fields=[{id:10},{id:20}];assert.deepEqual(getVisibleFields({id:1,collapsed:true,fields},[{startTableId:1,endTableId:2,startFieldId:20,endFieldId:1}]),[fields[1]])});
test('selection rectangles',()=>assert.deepEqual(getRectFromEndpoints({x1:20,x2:10,y1:40,y2:5}),{x:10,y:5,width:10,height:35}));
test('rectangle containment',()=>assert.equal(isInsideRect({x:1,y:1,width:2,height:2},{x:0,y:0,width:10,height:10}),true));
test('cascade avoids occupied positions',()=>assert.deepEqual(cascadePosition({x:0,y:0},[{x:0,y:0},{x:30,y:30}]),{x:60,y:60}));
test('schema diff records scalar edit',()=>{const acc={};deepDiff({name:'a'},{name:'b'},acc);assert.deepEqual(acc,{name:{from:'a',to:'b'}})});
`
    );
    contract = {
      version: 1,
      source: { module: entry, export: 'dequal' },
      target: { module: 'src/utils/utils.js', export: 'arrayIsEqual' },
      runtime: { relativeImports: true },
      cases: samples.map(([name, a, b, expected]) => ({
        name,
        sourceArgs: [a, b],
        targetArgs: [a, b],
        expected
      })),
      regression: { command: process.execPath, args: ['--test', 'test/portsmith-regression.test.mjs'] },
      checks: [
        {
          name: 'Full upstream production build',
          command: process.execPath,
          args: ['node_modules/vite/bin/vite.js', 'build']
        }
      ]
    };
    contextFiles = ['src/utils/utils.js', 'src/components/EditorSidePanel/Issues.jsx'];
  } else {
    source = path.join(base, 'repos/fast-json-stable-stringify');
    entry = 'index.js';
    mount = 'src/lib/features/stable-json';
    await fs.writeFile(
      path.join(target, 'test/portsmith-boundary.mjs'),
      `import {serializeState} from '../src/lib/util/serde.ts';
import {inflate} from 'pako';
export function serializedJSON(state,serde){const encoded=serializeState(state,serde);const [type,data]=encoded.split(':');const bytes=Buffer.from(data,'base64url');return type==='pako'?inflate(bytes,{to:'string'}):bytes.toString('utf8');}
`
    );
    await fs.writeFile(
      path.join(target, 'test/portsmith-check.mjs'),
      `import {execFileSync} from 'node:child_process';
execFileSync(process.execPath,['node_modules/@sveltejs/kit/svelte-kit.js','sync'],{stdio:'inherit'});
execFileSync(process.execPath,['node_modules/svelte-check/bin/svelte-check','--tsconfig','./tsconfig.json'],{stdio:'inherit'});
`
    );
    await fs.writeFile(
      path.join(target, 'test/portsmith-build.mjs'),
      `import {execFileSync} from 'node:child_process';
for(const args of [['build','--config','vite.embed.config.js'],['build']])execFileSync(process.execPath,['node_modules/vite/bin/vite.js',...args],{stdio:'inherit'});
`
    );
    const samples = [
      [{ z: 1, a: 2 }, '{"a":2,"z":1}'],
      [
        { code: 'graph TD; A-->B', mermaid: '{}', grid: true },
        '{"code":"graph TD; A-->B","grid":true,"mermaid":"{}"}'
      ],
      [{ pan: { y: 4, x: 3 }, grid: false }, '{"grid":false,"pan":{"x":3,"y":4}}'],
      [{ list: [{ b: 2, a: 1 }, null, true] }, '{"list":[{"a":1,"b":2},null,true]}'],
      [{ z: '😀 café', a: 'a\nb' }, '{"a":"a\\nb","z":"😀 café"}'],
      [{}, '{}'],
      [{ b: 0, a: false, c: null }, '{"a":false,"b":0,"c":null}'],
      [
        { code: 'flowchart TD\nA["quoted"]', grid: true },
        '{"code":"flowchart TD\\nA[\\"quoted\\"]","grid":true}'
      ]
    ];
    contract = {
      version: 1,
      source: { module: entry, export: 'default' },
      target: { module: 'test/portsmith-boundary.mjs', export: 'serializedJSON' },
      cases: samples.flatMap(([state, expected], i) =>
        ['base64', 'pako'].map((serde) => ({
          name: `Canonical state ${i} via ${serde}`,
          sourceArgs: [state],
          targetArgs: [state, serde],
          expected
        }))
      ),
      regression: {
        command: process.execPath,
        args: [
          'node_modules/vitest/vitest.mjs',
          'run',
          ...Object.keys(await inventory(target)).filter((x) => x.endsWith('.test.ts'))
        ]
      },
      checks: [
        {
          name: 'Full upstream Svelte/TypeScript check',
          command: process.execPath,
          args: ['test/portsmith-check.mjs']
        },
        {
          name: 'Full embed and editor production builds',
          command: process.execPath,
          args: ['test/portsmith-build.mjs']
        }
      ]
    };
    contextFiles = ['src/lib/util/serde.ts', 'src/lib/types.d.ts', 'src/lib/constants.ts'];
  }
  const folder = await fs.mkdtemp(path.join(base, `${name}-`));
  const contractFile = path.join(folder, 'contract-input.json');
  await saveJson(contractFile, contract);
  const run = path.join(folder, 'run');
  await prepare({ source, target, entry, mount, contract: contractFile, out: run });
  for (const side of ['baseline', 'candidate']) {
    execFileSync('cp', [
      '-cR',
      await fs.realpath(path.join(target, 'node_modules')),
      path.join(run, side, 'node_modules')
    ]);
    if (name === 'mermaid-live-editor')
      execFileSync(process.execPath, ['node_modules/@sveltejs/kit/svelte-kit.js', 'sync'], {
        cwd: path.join(run, side),
        stdio: 'inherit'
      });
  }
  const config = path.join(folder, 'model.json');
  await saveJson(config, {
    ...(await readJson('portsmith.model.json')),
    contextFiles,
    maxContextBytes: 400000
  });
  await saveJson(path.join(base, `${name}-latest.json`), { folder, run, config });
  console.log(run);
} else throw Error('--mode prepare|run');
