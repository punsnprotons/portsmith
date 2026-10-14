import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from '../../platform/process.mjs';
import { hash } from '../../platform/files.mjs';
export async function setupPatch(stage, original, prepared, changes) {
  const root = path.join(stage, 'patch');
  for (const side of ['baseline', 'candidate']) await fs.mkdir(path.join(root, side), { recursive: true });
  for (const item of changes) {
    const before = path.join(root, 'baseline', item.path),
      after = path.join(root, 'candidate', item.path);
    await fs.mkdir(path.dirname(before), { recursive: true });
    await fs.mkdir(path.dirname(after), { recursive: true });
    if (item.beforeSha256 !== null) await fs.copyFile(path.join(original, item.path), before);
    await fs.copyFile(path.join(prepared, item.path), after);
  }
  const diff = await runProcess(
    'git',
    [
      'diff',
      '--no-index',
      '--no-renames',
      '--binary',
      '--no-ext-diff',
      '--no-textconv',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      'baseline',
      'candidate'
    ],
    { cwd: root, maxOutputBytes: 32000000 }
  );
  if (![0, 1].includes(diff.exitCode) || diff.reason) throw Error('Setup patch generation failed.');
  let inHunk = false;
  const patch = diff.stdout
    .split('\n')
    .map((line) => {
      if (line.startsWith('diff --git ')) {
        inHunk = false;
        return line.replace(/^(diff --git "?a\/)\w+\//, '$1').replace(/ ("?b\/)\w+\//, ' $1');
      }
      if (line.startsWith('@@') || line === 'GIT binary patch') inHunk = true;
      return !inHunk && /^(--- |\+\+\+ )/.test(line)
        ? line.replace(/^((?:--- |\+\+\+ )"?[ab]\/)\w+\//, '$1')
        : line;
    })
    .join('\n');
  if (patch) {
    const file = path.join(root, 'setup.patch');
    await fs.writeFile(file, patch);
    for (const args of [
      ['-c', 'init.templateDir=', 'init', '--quiet'],
      ['apply', '--check', file],
      ['apply', file]
    ]) {
      const result = await runProcess('git', args, { cwd: path.join(root, 'baseline') });
      if (result.exitCode !== 0 || result.reason) throw Error('Setup patch replay failed.');
    }
    for (const item of changes)
      if (hash(await fs.readFile(path.join(root, 'baseline', item.path))) !== item.afterSha256)
        throw Error('Setup patch replay mismatch.');
  }
  return patch;
}
