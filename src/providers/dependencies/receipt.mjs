import fs from 'node:fs/promises';
import path from 'node:path';
import { safePath, hash } from '../../platform/files.mjs';
export async function dependencyReceipt(run) {
  let bytes;
  try {
    bytes = await fs.readFile(await safePath(run, 'dependencies.json'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  const receipt = JSON.parse(bytes);
  if (receipt.status !== 'installed')
    throw Error('Dependency setup is incomplete; rerun install-deps before verification.');
  if (
    receipt.version !== 1 ||
    !Array.isArray(receipt.sides) ||
    receipt.sides.length !== 3 ||
    new Set(receipt.sides.map((item) => item.side)).size !== 3 ||
    receipt.sides.some(
      (item) =>
        !['source', 'baseline', 'candidate'].includes(item.side) ||
        !['installed', 'not-needed'].includes(item.status)
    )
  )
    throw Error('Invalid or incomplete dependency receipt.');
  for (const item of receipt.sides) {
    if (item.status === 'not-needed') continue;
    const root = path.join(run, item.side);
    if (!['source', 'baseline', 'candidate'].includes(item.side))
      throw Error('Invalid dependency receipt side.');
    for (const [file, expected] of Object.entries(item.inputs))
      if (hash(await fs.readFile(await safePath(root, file))) !== expected)
        throw Error('Dependency manifest or lockfile changed; prepare a fresh run.');
    for (const dir of item.directories ?? ['node_modules']) {
      if (
        typeof dir !== 'string' ||
        path.isAbsolute(dir) ||
        dir.includes('\\') ||
        dir.split('/').some((p) => !p) ||
        !/^(?:.+\/)?node_modules$/.test(dir) ||
        dir.split('/').some((p) => p === '..' || p === '.')
      )
        throw Error('Invalid dependency directory receipt.');
      const stat = await fs.lstat(path.join(root, dir));
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw Error('Installed dependency directory is missing or linked.');
    }
  }
  return {
    sha256: hash(bytes),
    status: 'installed',
    limitations: [
      'Receipt binds install inputs and completion, not every installed dependency byte. Runtime verification remains required.'
    ]
  };
}
