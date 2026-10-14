import fs from 'node:fs/promises';
import path from 'node:path';
import { isBuiltin } from 'node:module';
import { safePath, hash, relativeFile } from '../../platform/files.mjs';
export const captureFile = 'portsmith.resolved-aliases.json';
export async function capturedAliases(root) {
  let text;
  try {
    const file = await safePath(root, captureFile);
    if ((await fs.stat(file)).size > 2000000) throw Error('Captured aliases exceed 2 MB.');
    text = await fs.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  const data = JSON.parse(text);
  if (
    ![1, 2].includes(data.version) ||
    data.provider !== 'vite-build' ||
    data.command !== 'build' ||
    typeof data.mode !== 'string' ||
    !Array.isArray(data.records) ||
    data.records.length > 4000 ||
    !data.inputs ||
    typeof data.inputs !== 'object' ||
    Array.isArray(data.inputs)
  )
    throw Error('Invalid captured alias receipt.');
  const files = [{ path: captureFile, sha256: hash(text) }],
    seen = new Set();
  for (const [rel, expected] of Object.entries(data.inputs)) {
    if (hash(await fs.readFile(await safePath(root, rel))) !== expected)
      throw Error('Captured alias configuration changed; recapture in a new copy.');
    files.push({ path: rel, sha256: expected });
  }
  if (data.version === 2) {
    if (!Array.isArray(data.generated) || data.generated.length > 100)
      throw Error('Invalid virtual module receipt.');
    for (const item of data.generated) {
      if (
        !/^portsmith-virtual\/[a-f0-9]{32}\.mjs$/.test(item.path) ||
        hash(await fs.readFile(await safePath(root, item.path))) !== item.sha256
      )
        throw Error('Captured virtual module changed; recapture in a new copy.');
      files.push({ path: item.path, sha256: item.sha256 });
    }
  }
  for (const record of data.records) {
    relativeFile(record.importer);
    if (
      typeof record.specifier !== 'string' ||
      !record.specifier ||
      record.specifier.startsWith('.') ||
      isBuiltin(record.specifier) ||
      !['local', 'external', 'unresolved', 'unsupported', 'outside'].includes(record.kind)
    )
      throw Error('Invalid captured import.');
    const key = record.importer + '\0' + record.specifier;
    if (seen.has(key)) throw Error('Duplicate captured import.');
    seen.add(key);
    if (record.kind === 'local') await safePath(root, record.target);
    else if (record.target !== undefined) throw Error('Non-local captured import has a target.');
  }
  return {
    mappings: [],
    files,
    providers: ['vite-build-capture'],
    captured: {
      generated: data.generated ?? [],
      plannedImports: data.plannedImports ?? [],
      mode: data.mode,
      command: data.command,
      records: data.records,
      limitations: data.limitations
    }
  };
}
