import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { analyze } from '../src/providers/javascript/analyze.mjs';
import { inventory, copyInventory, hash, json, saveJson } from '../src/platform/files.mjs';
const root = process.cwd(),
  base = path.join(root, '.portsmith/rea-comparison');
const setup = JSON.parse(await fs.readFile(path.resolve('.portsmith/virtual-bench/setup-latest.json')));
const folder = await fs.mkdtemp(path.join(base, 'virtual-static-'));
const codeSource = path.join(folder, 'source'),
  codeTarget = path.join(folder, 'target');
await copyInventory(setup.source, codeSource, await inventory(setup.source));
await copyInventory(setup.target, codeTarget, await inventory(setup.target));
const config = JSON.parse(await fs.readFile(path.join(base, 'config.json')));
config.args[config.args.indexOf('--name') + 1] = 'portsmith-rea-virtual';
config.args.splice(
  config.args.indexOf('run') + 1,
  0,
  '-v',
  codeSource + ':/jsondiffpatch:ro',
  '-v',
  codeTarget + ':/drawdb:ro'
);
const client = new Client({ name: 'matched-benchmark', version: '1' });
const t = new StdioClientTransport({
  ...config,
  stderr: 'pipe',
  env: { PATH: process.env.PATH, HOME: folder }
});
let err = '';
t.stderr.on('data', (b) => (err += b));
const cases = [
  ['jsondiffpatch', setup.entry, 'drawdb'],
  ['drawdb', setup.targetEntry, 'jsondiffpatch']
];
const results = [];
async function call(label, name, args) {
  const start = performance.now();
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 360000 });
  await saveJson(path.join(folder, label + '.json'), res);
  console.log(
    label,
    JSON.stringify({
      ms: Math.round(performance.now() - start),
      isError: res.isError,
      bytes: JSON.stringify(res).length
    })
  );
  if (res.isError) throw Error(JSON.stringify(res.structuredContent ?? res.content).slice(0, 2500));
  return {
    evidence: res.structuredContent,
    ms: Math.round(performance.now() - start),
    bytes: JSON.stringify(res).length
  };
}
try {
  await client.connect(t, { timeout: 60000 });
  for (const [name, entry, target] of cases) {
    const source = name === 'jsondiffpatch' ? codeSource : codeTarget;
    const before = await inventory(source);
    let record = { name, entry, inventorySha256: hash(json(before)), rea: {}, portsmith: {} };
    const start = performance.now();
    try {
      const a = await analyze({
        source,
        target: target === 'jsondiffpatch' ? codeSource : codeTarget,
        entry,
        aliases: true
      });
      await saveJson(path.join(folder, name + '-portsmith.json'), a);
      record.portsmith = {
        ms: Math.round(performance.now() - start),
        files: a.files.length,
        edges: a.edges.length,
        blockers: a.blockers
      };
    } catch (e) {
      record.portsmith.error = e.message;
    }
    try {
      const a = await call(name + '-summary', 'analyze_javascript_application', {
        input_path: '/' + name,
        detail: 'summary',
        analysis_timeout_ms: 120000,
        max_heap_mb: 1024
      });
      record.rea.analysisMs = a.ms;
      record.rea.summary = a.evidence;
      const id = a.evidence.normalized_result.parent_evidence_id;
      const ref = { kind: 'retained-evidence', evidence_id: id };
      let offset = 0,
        entries = [];
      do {
        const p = await call(name + '-modules-' + offset, 'inspect_analysis_view', {
          source: ref,
          view: { kind: 'page', collection: 'modules', offset, limit: 100 }
        });
        entries.push(p.evidence);
        const n = p.evidence.normalized_result;
        console.log('page-shape', name, Object.keys(n), JSON.stringify(n.coverage));
        offset = n.coverage?.next_offset ?? null;
      } while (offset !== null);
      await saveJson(path.join(folder, name + '-pages.json'), entries);
      const trace = await call(name + '-trace', 'trace_application_feature', {
        application: ref,
        seed: { kind: 'module', value: entry, match: 'exact', case_sensitive: true },
        direction: 'outgoing'
      });
      record.rea.traceMs = trace.ms;
      record.rea.trace = trace.evidence;
    } catch (e) {
      record.rea.error = e.message;
      console.log(name, 'ERROR', e.message.slice(0, 800));
    }
    record.originalUnchanged = json(before) === json(await inventory(source));
    results.push(record);
    await saveJson(path.join(folder, 'results.json'), results);
  }
} finally {
  await client.close();
  await fs.writeFile(path.join(folder, 'stderr.log'), err);
  await saveJson(path.join(root, '.portsmith/virtual-bench/static-latest.json'), { folder, results });
}
console.log('DONE', folder);
