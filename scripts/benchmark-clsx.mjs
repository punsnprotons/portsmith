import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { project } from './fixture.mjs';
import { hash, readJson, saveJson, rootDir } from '../src/platform/files.mjs';
import { runProcess } from '../src/platform/process.mjs';
import { prepare, adapt, verify, exportPatch, loadRun, assertIntegrity } from '../src/application/transfer.mjs';
import { traceWithRea } from '../src/providers/rea/client.mjs';

const revision = '925494cf31bcd97d3337aacd34e659e80cae7fe2';
const { values } = parseArgs({ options: { source: { type: 'string' }, 'rea-config': { type: 'string' }, 'allow-execution': { type: 'boolean' } } });
if (!values.source || !values['allow-execution']) throw new Error('Usage: node scripts/benchmark-clsx.mjs --source /path/to/reviewed/clsx --allow-execution [--rea-config FILE]');
const source = await rootDir(values.source);
const head = await runProcess('git', ['rev-parse', 'HEAD'], { cwd: source });
if (head.exitCode !== 0 || head.stdout.trim() !== revision) throw new Error(`Benchmark requires clsx revision ${revision}.`);
const dirty = await runProcess('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: source });
if (dirty.exitCode !== 0 || dirty.stdout.trim()) throw new Error('Benchmark source must be an unchanged checkout.');
const parent = path.join(project, '.portsmith');
await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'clsx-'));
const target = path.join(root, 'target');
await fs.cp(path.join(project, 'examples/classnames-target'), target, { recursive: true });
const cases = [
  ['strings retain order', ['button', 'primary'], 'button primary'],
  ['empty arguments', [], ''],
  ['conditional object keys', [{ active: true, hidden: false }, 'button'], 'active button'],
  ['nested arrays', ['button', ['primary', ['rounded']]], 'button primary rounded'],
  ['discard false values', [null, false, 0, '', 'visible'], 'visible'],
  ['numeric tokens', [42, 'count'], '42 count'],
  ['mixed conditional inputs', ['button', { primary: true, disabled: false }, ['rounded', null]], 'button primary rounded'],
  ['nested object inputs', [[{ selected: 1 }, [{ hidden: 0, focus: true }]]], 'selected focus']
];
const contract = { version: 1, source: { module: 'src/index.js', export: 'clsx' },
  target: { module: 'src/button.mjs', export: 'classNames' },
  cases: cases.map(([name, args, expected]) => ({ name, sourceArgs: args, targetArgs: args, expected })),
  regression: { command: process.execPath, args: ['--test', 'test/button.test.mjs'] }
};
await saveJson(path.join(root, 'contract.json'), contract);
const run = path.join(root, 'run');
await prepare({ source, target, entry: 'src/index.js', mount: 'src/features/conditional-classes', contract: path.join(root, 'contract.json'), out: run });
let upstreamAnalysis = null;
if (values['rea-config']) {
  const context = await loadRun(run);
  upstreamAnalysis = await traceWithRea({ ...context, configFile: values['rea-config'], allowExecution: true, checkIntegrity: () => assertIntegrity(context) });
}
const original = await fs.readFile(path.join(target, 'src/button.mjs'), 'utf8');
const content = `import { clsx } from './features/conditional-classes/src/index.js';\n\n` +
  original.replace("return inputs.filter(value => typeof value === 'string' && value).join(' ');", 'return clsx(...inputs);');
await saveJson(path.join(root, 'proposal.json'), { edits: [{ path: 'src/button.mjs', beforeSha256: hash(original), content }] });
await adapt(run, path.join(root, 'proposal.json'));
const report = await verify(run, { allowExecution: true });
const count = check => check.cases?.filter(c => c.status === 'passed').length ?? 0;
const result = {
  benchmark: 'clsx-to-button-model', sourceRepository: 'https://github.com/lukeed/clsx', sourceRevision: revision,
  destination: 'Owned button-model fixture; not an external production app', adaptation: 'Authored integration proposal',
  status: report.status, cases: cases.length, sourcePassed: count(report.source), baselinePassed: count(report.baseline), candidatePassed: count(report.candidate),
  regressions: Object.fromEntries(Object.entries(report.regression).map(([k, v]) => [k, v.status])),
  rea: upstreamAnalysis ? { server: upstreamAnalysis.server, coverage: upstreamAnalysis.coverage, facts: upstreamAnalysis.facts } : null,
  run, limitation: 'One small external-source transfer into a controlled destination; no comparative agent benchmark or browser rendering tested.'
};
if (report.status === 'verified-for-contract') result.patch = (await exportPatch(run)).patch;
await saveJson(path.join(root, 'result.json'), result);
console.log(JSON.stringify(result, null, 2));
if (report.status !== 'verified-for-contract') {
  console.error(JSON.stringify({ source: report.source, baseline: report.baseline, candidate: report.candidate, integrity: report.integrity }));
  process.exitCode = 1;
}
