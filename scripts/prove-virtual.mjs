import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { verify } from '../src/index.mjs';
import { inventory, copyInventory, readJson, saveJson, same, hash } from '../src/platform/files.mjs';
import { runProcess } from '../src/platform/process.mjs';
const paired = await readJson('.portsmith/virtual-bench/paired-latest.json'),
  setup = await readJson('.portsmith/virtual-bench/setup-latest.json');
const root = await fs.mkdtemp(path.join(paired.root, 'proof-')),
  results = [];
// Test modules live in excluded .portsmith execution metadata; they are never proposal inputs or patch content.
const holdout = `import {createRequire} from 'node:module';const YAML=createRequire(import.meta.url)('yaml');import assert from 'node:assert/strict';import{stateHistory,statesEqual}from'../src/utils/deltaHistory.js';import{arrayIsEqual}from'../src/utils/utils.js';
let seed=824221;const rand=()=>((seed=(1664525*seed+1013904223)>>>0)/2**32);const integer=n=>Math.floor(rand()*n);let count=0;
for(let i=0;i<500;i++){
 let state={tables:Array.from({length:1+integer(8)},(_,id)=>({id,name:'table_'+id,fields:[{id:0,name:'id',type:'int'}]})),meta:{title:'diagram '+i,labels:['α','日本語']}};
 const series=[structuredClone(state)];const changed=[];
 for(let j=0;j<8;j++){const before=structuredClone(state);switch(integer(5)){case 0:state.tables.reverse();break;case 1:state.tables.push({id:100+j,name:'new',fields:[]});break;case 2:state.tables=state.tables.slice(1);break;case 3:state.meta.title+='!';break;case 4:if(state.tables[0])state.tables[0].fields.push({id:j+1,name:'f'+j,type:'text'});break;}changed.push(!statesEqualIndependent(before,state));series.push(structuredClone(state));}
 const untouched=structuredClone(series),expected={latest:series.at(-1),restored:series[0],changed};const docs=series.map(x=>YAML.stringify(x)).join('---\\n');assert.deepEqual(stateHistory(docs),expected);assert.deepEqual(series,untouched);count++;
 const a=[{id:i,name:'issue',detail:{a:1,b:2}}],b=[{detail:{b:2,a:1},name:'issue',id:i}];assert.equal(statesEqual(a,b),true);assert.equal(arrayIsEqual(a,b),true);assert.equal(arrayIsEqual(a,[...b,{id:-1}]),false);
}
function statesEqualIndependent(a,b){try{assert.deepEqual(a,b);return true;}catch{return false;}}
for(const input of ['', '   ', '# no snapshots\\n', 'broken: ['])assert.throws(()=>stateHistory(input));
console.log(JSON.stringify({invalidDocuments:4,histories:count,transitions:count*8,consumerAssertions:count*3,status:'passed'}));`;
for (const item of paired.results) {
  assert.equal(item.status, 'verified-for-contract');
  const replay = path.join(root, item.arm);
  await fs.mkdir(replay);
  for (const side of ['source', 'baseline', 'candidate']) {
    const from = path.join(item.run, side === 'candidate' ? 'baseline' : side),
      to = path.join(replay, side);
    await copyInventory(from, to, await inventory(from));
    execFileSync('cp', ['-cR', path.join(from, 'node_modules'), path.join(to, 'node_modules')]);
  }
  for (const f of ['state.json', 'contract.json'])
    await fs.copyFile(path.join(item.run, f), path.join(replay, f));
  for (const args of [
    ['-c', 'init.templateDir=', 'init', '--quiet'],
    ['apply', '--check', path.join(item.run, 'transfer.patch')],
    ['apply', path.join(item.run, 'transfer.patch')]
  ]) {
    const r = await runProcess('git', args, { cwd: path.join(replay, 'candidate') });
    assert.equal(r.exitCode, 0, r.stderr);
  }
  assert(
    same(await inventory(path.join(replay, 'candidate')), await inventory(path.join(item.run, 'candidate')))
  );
  const report = await verify(replay, { allowExecution: true, timeoutMs: 120000 });
  assert.equal(report.status, 'verified-for-contract', JSON.stringify(report));
  await fs.mkdir(path.join(replay, 'candidate/.portsmith'), { recursive: true });
  await fs.writeFile(path.join(replay, 'candidate/.portsmith/holdout.mjs'), holdout);
  const h = await runProcess(
    process.execPath,
    ['--import', path.resolve('src/providers/node/register-aliases.mjs'), '.portsmith/holdout.mjs'],
    { cwd: path.join(replay, 'candidate'), timeoutMs: 120000 }
  );
  assert.equal(h.exitCode, 0, h.stderr);
  assert.equal(h.reason, null);
  await saveJson(path.join(replay, 'holdouts.json'), JSON.parse(h.stdout));
  results.push({
    arm: item.arm,
    replay,
    status: report.status,
    patchSha256: hash(await fs.readFile(path.join(item.run, 'transfer.patch'))),
    holdouts: JSON.parse(h.stdout)
  });
  await saveJson(path.join(root, 'results.json'), results);
  console.log(item.arm, 'REPLAY', report.status);
}
assert(same(setup.originalSourceInventory, await inventory(setup.original)));
await saveJson(path.join('.portsmith/virtual-bench', 'proof-latest.json'), { root, results });
