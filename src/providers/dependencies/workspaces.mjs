import fs from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import {
  inventory,
  readJson,
  safePath,
  relativeFile,
  hash,
  inside,
  excluded
} from '../../platform/files.mjs';
export function yamlData(text, label) {
  if (Buffer.byteLength(text) > 10000000) throw Error(label + ' exceeds 10 MB.');
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) throw Error('Invalid ' + label + ': ' + doc.errors[0].message);
  return doc.toJS({ maxAliasCount: 0 });
}
function patternRegex(pattern) {
  if (
    typeof pattern !== 'string' ||
    !pattern ||
    pattern.startsWith('/') ||
    pattern.includes('\\') ||
    pattern.split('/').some((p) => p === '..' || p === '.' || !p) ||
    /[^A-Za-z0-9_@!.*\/-]/.test(pattern)
  )
    throw Error('Unsupported workspace pattern: ' + pattern);
  const segments = pattern.split('/');
  return new RegExp(
    '^' +
      segments
        .map((part, index) =>
          part === '**'
            ? index === segments.length - 1
              ? '.*'
              : '(?:[^/]+/)*'
            : part.replace(/[.+]/g, '\\$&').replace(/\*/g, '[^/]*') +
              (index === segments.length - 1 ? '' : '/')
        )
        .join('') +
      '$'
  );
}
export async function workspaceLayout(root, manifest) {
  let settings = null;
  try {
    settings = yamlData(
      await fs.readFile(await safePath(root, 'pnpm-workspace.yaml'), 'utf8'),
      'pnpm-workspace.yaml'
    );
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (settings !== null && (!settings || typeof settings !== 'object' || Array.isArray(settings)))
    throw Error('Invalid pnpm workspace settings.');
  const patterns = manifest.workspaces ?? settings?.packages;
  if (manifest.workspaces && settings?.packages)
    throw Error('Declare workspace packages in one manager configuration only.');
  if (patterns !== undefined && (!Array.isArray(patterns) || !patterns.length))
    throw Error('Workspace packages must be a nonempty array of simple directory patterns.');
  const allowed = new Set([
    'packages',
    'catalog',
    'catalogs',
    'onlyBuiltDependencies',
    'ignoredBuiltDependencies',
    'neverBuiltDependencies',
    'allowBuilds',
    'overrides',
    'peerDependencyRules',
    'autoInstallPeers',
    'strictPeerDependencies',
    'linkWorkspacePackages',
    'preferWorkspacePackages',
    'hoistWorkspacePackages',
    'saveWorkspaceProtocol'
  ]);
  for (const key of Object.keys(settings ?? {}))
    if (!allowed.has(key))
      throw Error(
        'Unsupported pnpm workspace setting: ' +
          key +
          '. Provision manually or use a reviewed minimal configuration in a new run.'
      );
  const files = await inventory(root),
    members = [],
    metadata = { 'package.json': hash(await fs.readFile(await safePath(root, 'package.json'))) };
  if (settings !== null)
    metadata['pnpm-workspace.yaml'] = hash(await fs.readFile(await safePath(root, 'pnpm-workspace.yaml')));
  const rules = (patterns ?? []).map((p) => ({
    exclude: p.startsWith('!'),
    regex: patternRegex(p.replace(/^!/, ''))
  }));
  for (const rel of Object.keys(files)) {
    if (!rel.endsWith('/package.json')) continue;
    const dir = rel.slice(0, -13);
    if (
      !rules.some((p) => !p.exclude && p.regex.test(dir)) ||
      rules.some((p) => p.exclude && p.regex.test(dir))
    )
      continue;
    const pkg = await readJson(await safePath(root, rel));
    if (typeof pkg.name !== 'string' || !pkg.name) throw Error('Workspace package needs a name: ' + dir);
    if (members.some((p) => p.name === pkg.name) || pkg.name === manifest.name)
      throw Error('Duplicate workspace package name: ' + pkg.name);
    if (members.length >= 100) throw Error('Workspace exceeds 100 packages; use a narrower workspace.');
    members.push({ dir, name: pkg.name, manifest: pkg });
    metadata[rel] = files[rel].sha256;
  }
  if (patterns && !members.length) throw Error('Workspace patterns matched no package manifests.');
  const packages = [{ dir: '.', name: manifest.name, manifest }, ...members];
  for (const pkg of packages) {
    if (pkg.manifest.workspaces && pkg.dir !== '.')
      throw Error('Nested workspace declarations are unsupported.');
    if (Object.values(pkg.manifest.dependenciesMeta ?? {}).some((x) => x?.injected))
      throw Error('Injected workspace dependencies require full-source provisioning.');
    for (const bin of typeof pkg.manifest.bin === 'string'
      ? [pkg.manifest.bin]
      : Object.values(pkg.manifest.bin ?? {})) {
      if (typeof bin !== 'string') throw Error('Invalid workspace binary path.');
      const rel = path.posix.join(pkg.dir, bin);
      relativeFile(rel);
      if (pkg.dir !== '.' && !rel.startsWith(pkg.dir + '/'))
        throw Error('Workspace binary escapes its package.');
      metadata[rel] = hash(await fs.readFile(await safePath(root, rel)));
    }
  }
  return {
    enabled: members.length > 0,
    manager: manifest.workspaces ? 'npm' : settings?.packages ? 'pnpm' : null,
    members,
    packages,
    metadata,
    settings
  };
}
export async function dependencyDirectories(root) {
  const dirs = [];
  let count = 0;
  async function walk(rel = '') {
    for (const e of await fs.readdir(path.join(root, rel), { withFileTypes: true })) {
      const local = rel ? rel + '/' + e.name : e.name;
      if (e.name === 'node_modules') {
        if (e.isSymbolicLink() || !e.isDirectory())
          throw Error('Dependency directories must be real directories: ' + local);
        dirs.push(local);
        continue;
      }
      if (excluded(local)) continue;
      if (e.isDirectory()) {
        if (++count > 5000) throw Error('Dependency directory scan limit exceeded.');
        await walk(local);
      }
    }
  }
  await walk();
  return dirs.sort();
}
export async function validateDependencyLinks(root, dirs) {
  let count = 0;
  async function walk(local) {
    for (const e of await fs.readdir(path.join(root, local), { withFileTypes: true })) {
      if (++count > 500000) throw Error('Installed dependency link scan limit exceeded.');
      const file = path.join(root, local, e.name);
      if (e.isSymbolicLink()) {
        const link = await fs.readlink(file);
        if (path.isAbsolute(link))
          throw Error('Installed dependency link must be relative: ' + path.posix.join(local, e.name));
        const target = path.resolve(path.dirname(file), link);
        if (!inside(root, target))
          throw Error('Installed dependency link escapes snapshot: ' + path.posix.join(local, e.name));
      } else if (e.isDirectory()) await walk(path.posix.join(local, e.name));
    }
  }
  for (const dir of dirs) await walk(dir);
}
