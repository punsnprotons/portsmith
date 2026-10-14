import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Explicit source archive boundary: never recurse into local runs or credentials.
export const sourceEntries = [
  '.env.example',
  '.github',
  '.gitignore',
  '.prettierrc.json',
  'AGENTS.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'THIRD_PARTY_NOTICES.md',
  'docs',
  'examples',
  'package.json',
  'package-lock.json',
  'portsmith.model.json',
  'scripts',
  'skills',
  'src',
  'test'
];
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function releaseInventory(root, entries = sourceEntries) {
  const files = {};
  async function visit(relative) {
    const full = path.join(root, relative),
      stat = await fs.lstat(full);
    const name = path.basename(relative);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
      throw Error(`Release contains a non-regular file: ${relative}`);
    if (
      ['.git', '.portsmith', 'node_modules', '.npmrc'].includes(name) ||
      (name.startsWith('.env') && name !== '.env.example') ||
      /\.(pem|key|p12|pfx)$/i.test(name)
    )
      throw Error(`Private/generated path in release: ${relative}`);
    if (stat.isDirectory()) {
      for (const child of (await fs.readdir(full)).sort()) await visit(path.join(relative, child));
    } else {
      const bytes = await fs.readFile(full),
        text = bytes.toString('utf8');
      // Conservative credential patterns; no matched values are ever printed.
      if (
        /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) ||
        /\b(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_-]{24,}/.test(text) ||
        /\bAKIA[A-Z0-9]{16}\b/.test(text)
      )
        throw Error(`Possible credential in ${relative}`);
      files[relative.split(path.sep).join('/')] = sha256(bytes);
    }
  }
  for (const entry of entries) await visit(entry);
  return files;
}

export async function copyRelease(root, destination, inventory) {
  await fs.mkdir(destination);
  for (const relative of Object.keys(inventory)) {
    const to = path.join(destination, relative);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(path.join(root, relative), to);
    await fs.chmod(to, (await fs.stat(path.join(root, relative))).mode & 0o777);
  }
}
