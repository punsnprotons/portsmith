import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { inventory, copyInventory, saveJson, readJson, hash, json } from '../src/platform/files.mjs';
const base = path.resolve('.portsmith/rea-comparison'),
  root = await fs.mkdtemp(path.join(base, 'focused-'));
const { folder } = await readJson(path.join(base, 'static-latest.json'));
const a = await readJson(path.join(folder, 'drawdb-portsmith.json'));
const source = path.join(root, 'source');
await fs.mkdir(source);
let inv = await inventory(a.source);
const selected = Object.fromEntries(
  Object.entries(inv).filter(
    ([p]) => a.files.some((f) => f.path === p) || p === 'package.json' || p === 'LICENSE'
  )
);
await copyInventory(a.source, source, selected);
await saveJson(path.join(root, 'scope.json'), {
  original: a.source,
  inventory: selected,
  reason:
    'Recover focused module evidence after whole-app memory coverage limits. Both tools see the identical three-file closure plus root manifest/license. This scope was selected using Portsmith and is not independent feature discovery.'
});
const config = await readJson(path.join(base, 'config.json'));
config.args[config.args.findIndex((x) => x.endsWith(':/repos:ro'))] = source + ':/repos:ro';
config.args[config.args.indexOf('--name') + 1] = 'portsmith-rea-focused';
const c = new Client({ name: 'matched-benchmark', version: '1' });
const t = new StdioClientTransport({
  ...config,
  stderr: 'pipe',
  env: { PATH: process.env.PATH, HOME: root }
});
let stderr = '';
t.stderr.on('data', (b) => (stderr += b));
try {
  await c.connect(t);
  let r = await c.callTool(
    { name: 'analyze_javascript_application', arguments: { input_path: '/repos', detail: 'summary' } },
    undefined,
    { timeout: 180000 }
  );
  await saveJson(path.join(root, 'summary.json'), r);
  if (r.isError) throw Error(JSON.stringify(r.content));
  const ref = {
    kind: 'retained-evidence',
    evidence_id: r.structuredContent.normalized_result.parent_evidence_id
  };
  r = await c.callTool(
    {
      name: 'trace_application_feature',
      arguments: {
        application: ref,
        seed: { kind: 'module', value: 'src/utils/utils.js', match: 'exact', case_sensitive: true },
        direction: 'outgoing'
      }
    },
    undefined,
    { timeout: 60000 }
  );
  await saveJson(path.join(root, 'trace.json'), r);
  r = await c.callTool({
    name: 'inspect_analysis_view',
    arguments: { source: ref, view: { kind: 'page', collection: 'modules', offset: 0, limit: 100 } }
  });
  await saveJson(path.join(root, 'modules.json'), r);
  const items = r.structuredContent.normalized_result.items.filter((x) => x.path === 'src/utils/utils.js');
  for (const [i, item] of items.entries()) {
    r = await c.callTool({
      name: 'inspect_analysis_view',
      arguments: {
        source: ref,
        view: { kind: 'item', collection: 'modules', selector: { node_id: item.node_id } }
      }
    });
    await saveJson(path.join(root, 'item-' + i + '.json'), r);
  }
  await saveJson(path.join(base, 'focused-latest.json'), {
    root,
    sourceInventorySha256: hash(json(selected)),
    unchanged: json(selected) === json(await inventory(source))
  });
  console.log(root);
} finally {
  await c.close();
  await fs.writeFile(path.join(root, 'stderr.log'), stderr);
}
