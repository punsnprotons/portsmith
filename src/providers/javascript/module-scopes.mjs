import path from 'node:path';
import { safePath, readJson } from '../../platform/files.mjs';

// Preserve .js interpretation without bringing dependency declarations or lifecycle scripts.
export async function sourceModuleScopes(analysis) {
  const scopes = new Map([['package.json', { private: true }]]);
  const visited = new Set();
  for (const file of analysis.files) {
    let dir = path.posix.dirname(file.path);
    while (true) {
      const rel = dir === '.' ? 'package.json' : `${dir}/package.json`;
      if (!visited.has(rel)) {
        visited.add(rel);
        try {
          const manifest = await readJson(await safePath(analysis.source, rel));
          scopes.set(rel, {
            private: true,
            ...(['module', 'commonjs'].includes(manifest.type) ? { type: manifest.type } : {})
          });
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      if (dir === '.') break;
      dir = path.posix.dirname(dir);
    }
  }
  return [...scopes].map(([path, content]) => ({ path, content }));
}
