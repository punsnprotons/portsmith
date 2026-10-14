import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { capturedAliases } from './captured-aliases.mjs';
import { frameworkAliases } from './framework-aliases.mjs';
import { isBuiltin } from 'node:module';
import { safePath, relativeFile, inside, hash } from '../../platform/files.mjs';

// Data-only configs. Never execute a Vite/Webpack config or load a package's config.
export async function loadAliases(root) {
  root = path.resolve(root);
  let explicit = false;
  try {
    await fs.lstat(path.join(root, 'portsmith.aliases.json'));
    explicit = true;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const captured = await capturedAliases(root);
  if (captured) {
    if (explicit) throw Error('Choose either captured or explicit aliases, not both.');
    return captured;
  }
  const framework = explicit
    ? { mappings: [], files: [], providers: [] }
    : await frameworkAliases(root).catch((error) => {
        throw Error(
          error.message +
            ' For trusted dynamic Vite configuration, run capture-aliases --source <repo> --out <new-copy> --allow-execution, then use that copy with --aliases.'
        );
      });
  const files = [...framework.files],
    visiting = new Set();
  async function read(rel) {
    if (visiting.has(rel) || visiting.size >= 8)
      throw Error('Alias config cycle or depth exceeds eight files.');
    visiting.add(rel);
    const file = await safePath(root, rel);
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 100000)
      throw Error('Alias configuration must be a regular file under 100 KB.');
    const text = await fs.readFile(file, 'utf8');
    const parsed = ts.parseConfigFileTextToJson(rel, text);
    if (parsed.error) throw Error('Invalid alias JSON/JSONC configuration: ' + rel);
    files.push({ path: rel, sha256: hash(text) });
    const value = parsed.config;
    let inherited = { base: undefined, mappings: [] };
    if (value.extends) {
      const generated =
        value.extends === './.svelte-kit/tsconfig.json' && framework.providers.includes('sveltekit-2');
      const overridden =
        typeof value.extends === 'string' &&
        !value.extends.startsWith('.') &&
        value.compilerOptions?.paths &&
        typeof value.compilerOptions?.baseUrl === 'string';
      if (!generated && !overridden) {
        if (typeof value.extends !== 'string' || !value.extends.startsWith('.'))
          throw Error(
            'Package config aliases need explicit local paths and baseUrl, or portsmith.aliases.json.'
          );
        const absolute = path.resolve(root, path.dirname(rel), value.extends);
        if (!inside(root, absolute)) throw Error('Alias config extends escapes the repository.');
        let parent = path.relative(root, absolute).split(path.sep).join('/');
        if (!parent.endsWith('.json')) parent += '.json';
        inherited = await read(parent);
      }
    }
    const options = value.compilerOptions ?? {};
    const base =
      options.baseUrl === undefined ? inherited.base : path.resolve(root, path.dirname(rel), options.baseUrl);
    if (base && !inside(root, base)) throw Error('Alias baseUrl escapes the repository.');
    let mappings = inherited.mappings;
    if (options.paths !== undefined) {
      if (!options.paths || typeof options.paths !== 'object' || Array.isArray(options.paths))
        throw Error('Alias paths must be an object.');
      mappings = Object.entries(options.paths).map(([pattern, targets]) => {
        if (
          !pattern ||
          pattern.startsWith('.') ||
          pattern.startsWith('/') ||
          pattern.includes('\\') ||
          isBuiltin(pattern) ||
          (pattern.includes('*') && (!pattern.endsWith('/*') || pattern.indexOf('*') !== pattern.length - 1))
        )
          throw Error('Unsupported alias pattern: ' + pattern);
        if (!Array.isArray(targets) || targets.length !== 1 || typeof targets[0] !== 'string')
          throw Error('Each alias must have exactly one local target; fallback arrays are ambiguous.');
        const target = targets[0];
        if (
          (pattern.endsWith('*') ? !target.endsWith('/*') : target.includes('*')) ||
          target.indexOf('*') !== target.lastIndexOf('*')
        )
          throw Error('Alias wildcard must be trailing on both pattern and target.');
        const absolute = path.resolve(base ?? path.join(root, path.dirname(rel)), target.replace(/\*$/, ''));
        if (!inside(root, absolute)) throw Error('Alias target escapes the repository.');
        const local = path.relative(root, absolute).split(path.sep).join('/');
        if (local) relativeFile(local);
        return { pattern, target: local + (pattern.endsWith('*') ? (local ? '/' : '') + '*' : '') };
      });
    }
    visiting.delete(rel);
    return { base, mappings };
  }
  function merge(mappings) {
    const combined = new Map();
    for (const item of [...framework.mappings, ...mappings]) {
      if (combined.has(item.pattern) && combined.get(item.pattern) !== item.target)
        throw Error('Conflicting framework and TypeScript alias: ' + item.pattern);
      combined.set(item.pattern, item.target);
    }
    return {
      mappings: [...combined].map(([pattern, target]) => ({ pattern, target })),
      files: [...new Map(files.map((f) => [f.path, f])).values()],
      providers: framework.providers
    };
  }
  for (const rel of ['portsmith.aliases.json', 'tsconfig.json', 'jsconfig.json']) {
    try {
      await fs.lstat(path.join(root, rel));
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    const { mappings } = await read(rel);
    return merge(mappings);
  }
  return merge([]);
}
export function aliasTarget(spec, aliases, importer) {
  if (aliases.captured && !spec.startsWith('.') && !spec.startsWith('file:') && !isBuiltin(spec)) {
    const record = aliases.captured.records.find((r) => r.importer === importer && r.specifier === spec);
    if (!record)
      throw Error(
        `Uncaptured import ${spec} in ${importer}; capture this exact importer/specifier with --imports in a new copy before preparing a new run, or use a relative integration import.`
      );
    if (record.kind === 'external') return null;
    if (record.kind !== 'local')
      throw Error(`Captured import ${spec} in ${importer} is ${record.kind}; resolve this before transfer.`);
    return relativeFile(record.target);
  }
  const matches = aliases.mappings.filter(({ pattern }) =>
    pattern.endsWith('*') ? spec.startsWith(pattern.slice(0, -1)) : spec === pattern
  );
  matches.sort(
    (a, b) => Number(b.pattern === spec) - Number(a.pattern === spec) || b.pattern.length - a.pattern.length
  );
  if (!matches.length) return null;
  const { pattern, target } = matches[0];
  const resolved = pattern.endsWith('*') ? target.slice(0, -1) + spec.slice(pattern.length - 1) : target;
  return relativeFile(resolved);
}
export function relativeAlias(from, mapped) {
  const relative = path.posix.relative(path.posix.dirname(from), mapped);
  return relative.startsWith('.') ? relative : './' + relative;
}
export function rewriteAliases(text, rewrites) {
  for (const r of [...rewrites].sort((a, b) => b.start - a.start)) {
    if (text.slice(r.start, r.end) !== r.original) throw Error('Alias import changed after analysis.');
    text = text.slice(0, r.start) + JSON.stringify(r.replacement) + text.slice(r.end);
  }
  return text;
}
