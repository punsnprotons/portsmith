// Opt-in, frozen contract behavior. Only resolve extensionless relative code
// within the snapshot, never bare aliases, assets or installed dependencies.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
let root;
export async function initialize(data) {
  root = await fs.realpath(data.root);
}
const inside = (file) => file === root || file.startsWith(root + path.sep);
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      !['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(error.code) ||
      !specifier.startsWith('.') ||
      !context.parentURL?.startsWith('file:')
    )
      throw error;
    const parent = fileURLToPath(context.parentURL);
    if (!inside(parent) || parent.split(path.sep).includes('node_modules')) throw error;
    const url = new URL(specifier, context.parentURL);
    if (url.search || url.hash) throw error;
    const base = fileURLToPath(url);
    if (!inside(base) || path.extname(base)) throw error;
    for (const suffix of [
      '.js',
      '.mjs',
      '.cjs',
      '.ts',
      '.mts',
      '.cts',
      '/index.js',
      '/index.mjs',
      '/index.ts'
    ]) {
      const candidate = base + suffix;
      try {
        const real = await fs.realpath(candidate);
        if (!inside(real) || real.split(path.sep).includes('node_modules')) continue;
        if ((await fs.stat(real)).isFile()) return await nextResolve(pathToFileURL(real).href, context);
      } catch (probe) {
        if (!['ENOENT', 'ENOTDIR'].includes(probe.code)) throw probe;
      }
    }
    throw error;
  }
}
