import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PortsmithError } from '../domain/errors.mjs';

export const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const json = (value) => JSON.stringify(value, null, 2) + '\n';
export const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const skipped = new Set([
  '.git',
  'node_modules',
  '.portsmith',
  'dist',
  'build',
  'coverage',
  '.next',
  '.svelte-kit',
  '.DS_Store'
]);
export const excluded = (rel) => rel.split('/').some((p) => skipped.has(p) || /^\.env(?:\.|$)/.test(p));

export function relativeFile(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\\') ||
    value.includes('\0') ||
    path.isAbsolute(value) ||
    value.split('/').some((p) => !p || p === '.' || p === '..') ||
    excluded(value)
  ) {
    throw new PortsmithError(
      'unsafe_path',
      `Unsafe or excluded relative path: ${value}`,
      'Use a repository-relative path without traversal, excluded directories or absolute components.'
    );
  }
  return value;
}

export async function rootDir(value) {
  const root = await fs.realpath(path.resolve(value));
  if (!(await fs.stat(root)).isDirectory()) throw new Error(`Not a directory: ${root}`);
  return root;
}

export async function safePath(root, rel, { missing = false } = {}) {
  relativeFile(rel);
  let current = root;
  for (const part of rel.split('/')) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Symlinks are unsupported: ${rel}`);
    } catch (error) {
      if (missing && error.code === 'ENOENT') return path.join(root, rel);
      throw error;
    }
  }
  return current;
}

export async function inventory(root) {
  const files = Object.create(null);
  let total = 0;
  async function walk(dir, prefix = '') {
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const entry of entries) {
      const rel = prefix + entry.name;
      if (excluded(rel)) continue;
      if (entry.isSymbolicLink()) throw new Error(`Symlinks are unsupported: ${rel}`);
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel + '/');
      else if (entry.isFile()) {
        const filename = path.join(dir, entry.name);
        const stat = await fs.stat(filename);
        total += stat.size;
        if (stat.size > 10_000_000 || total > 100_000_000 || Object.keys(files).length >= 5000) {
          throw new Error(
            'Snapshot limit exceeded (5,000 files, 10 MB/file, 100 MB total); nothing is truncated.'
          );
        }
        files[rel] = { sha256: hash(await fs.readFile(filename)), executable: Boolean(stat.mode & 0o111) };
      } else throw new Error(`Special files are unsupported: ${rel}`);
    }
  }
  await walk(root);
  return files;
}

export async function copyInventory(from, to, files) {
  for (const [rel, meta] of Object.entries(files)) {
    const source = await safePath(from, rel);
    const bytes = await fs.readFile(source);
    if (hash(bytes) !== meta.sha256) throw new Error(`File changed while copying: ${rel}`);
    const dest = path.join(to, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, bytes, { flag: 'wx', mode: meta.executable ? 0o700 : 0o600 });
  }
}

export const same = (a, b) => json(a) === json(b);
export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
export async function safeWrite(file, bytes) {
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are unsupported: ${file}`);
    if (!stat.isFile()) throw new Error(`Output must be a regular file: ${file}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temp = path.join(path.dirname(file), `.write-${crypto.randomUUID()}`);
  try {
    await fs.writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
    await fs.rename(temp, file); // Replaces a raced-in link rather than following it.
  } finally {
    await fs.rm(temp, { force: true });
  }
}
export async function saveJson(file, value) {
  await safeWrite(file, json(value));
}

export async function withRunLock(directory, task) {
  const root = await rootDir(directory);
  const lock = path.join(root, '.portsmith-operation.lock');
  let handle;
  try {
    handle = await fs.open(lock, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new PortsmithError(
        'run_busy',
        'Transfer is busy or has a stale operation lock. Do not run simultaneous mutations.',
        'Wait for the active operation. Remove a stale lock only after confirming its recorded process has stopped.',
        {},
        { retryable: true }
      );
    throw error;
  }
  try {
    await handle.writeFile(json({ pid: process.pid, startedAt: new Date().toISOString() }));
    return await task();
  } finally {
    await handle.close();
    await fs.rm(lock, { force: true });
  }
}

export async function assertSnapshot(root, expected, label) {
  if (!same(await inventory(root), expected))
    throw new PortsmithError(
      'snapshot_changed',
      `${label} changed; prepare a new transfer.`,
      'Preserve your edits and prepare a fresh run with an updated contract.',
      { label }
    );
}
