import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

// Copy the installed Vite/YAML dependency closure rather than unrelated SDK,
// browser, formatting and test-runner packages into every isolated fixture.
export async function copyViteDependencies(to) {
  const root = path.resolve('node_modules'),
    seen = new Set();
  async function locate(name, from) {
    for (let dir = from; ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, 'node_modules', name);
      try {
        await fs.access(path.join(candidate, 'package.json'));
        return candidate;
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      if (path.dirname(dir) === dir)
        throw Object.assign(Error('Missing installed dependency: ' + name), { code: 'ENOENT' });
    }
  }
  async function visit(folder) {
    folder = await fs.realpath(folder);
    if (seen.has(folder)) return;
    seen.add(folder);
    if (!folder.startsWith(root + path.sep)) throw Error('Fixture dependency outside local install.');
    const pkg = JSON.parse(await fs.readFile(path.join(folder, 'package.json')));
    const target = path.join(to, path.relative(root, folder));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(folder, target, {
      recursive: true,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
      filter: (from) => from === folder || path.basename(from) !== 'node_modules'
    });
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      try {
        await visit(await locate(name, folder));
      } catch (e) {
        if (e.code !== 'ENOENT' || !Object.hasOwn(pkg.optionalDependencies ?? {}, name)) throw e;
      }
    }
  }
  for (const folder of ['vite', 'vitest-modern/node_modules/vite', 'yaml'])
    await visit(path.join(root, folder));
}
