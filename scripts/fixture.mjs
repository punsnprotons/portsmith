import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, saveJson } from '../src/platform/files.mjs';

export const project = fileURLToPath(new URL('../', import.meta.url));
export async function fixture(root) {
  await fs.cp(path.join(project, 'examples/source'), path.join(root, 'source'), { recursive: true });
  await fs.cp(path.join(project, 'examples/target'), path.join(root, 'target'), { recursive: true });
  const rows = [{ id: 1, name: 'Café beans' }, { id: 2, name: 'Tea leaves' }, { id: 3, name: 'Coffee grinder' }];
  const inputs = [
    ['empty query', '', rows], ['case insensitive', 'TEA', [rows[1]]], ['trim whitespace', '  coffee  ', [rows[2]]],
    ['fold accents', 'cafe', [rows[0]]], ['no matches', 'cocoa', []]
  ];
  const contract = { version: 1, source: { module: 'src/filter.mjs', export: 'filterRows' },
    target: { module: 'src/catalog.mjs', export: 'searchCatalog' },
    cases: inputs.map(([name, query, expected]) => ({ name, sourceArgs: [rows, query], targetArgs: [query], expected })),
    regression: { command: process.execPath, args: ['--test', 'test/catalog.test.mjs'] }
  };
  await saveJson(path.join(root, 'contract.json'), contract);
  const original = await fs.readFile(path.join(root, 'target/src/catalog.mjs'), 'utf8');
  const adapted = `import { filterRows } from './features/table-filter/src/filter.mjs';\n\n` +
    original.replace('return products.map(product => ({ ...product }));', 'return filterRows(products, query).map(product => ({ ...product }));');
  await saveJson(path.join(root, 'proposal.json'), { edits: [{ path: 'src/catalog.mjs', beforeSha256: hash(original), content: adapted }] });
  return { source: path.join(root, 'source'), target: path.join(root, 'target'), entry: 'src/filter.mjs', mount: 'src/features/table-filter', contract: path.join(root, 'contract.json'), out: path.join(root, 'run') };
}
