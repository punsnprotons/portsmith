import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  rootDir,
  inside,
  inventory,
  copyInventory,
  same,
  saveJson,
  hash,
  relativeFile,
  safePath
} from '../platform/files.mjs';
import {
  dependencyDirectories,
  validateDependencyLinks,
  workspaceLayout
} from '../providers/dependencies/workspaces.mjs';
import { captureFile, capturedAliases } from '../providers/javascript/captured-aliases.mjs';
import { virtualDirectory } from '../providers/vite/virtual-modules.mjs';
import { runProcess } from '../platform/process.mjs';
export async function captureAliases({
  source,
  out,
  imports,
  virtualModules = false,
  mode = 'production',
  allowExecution = false,
  timeoutMs = 120000
}) {
  if (allowExecution !== true)
    throw Error(
      'Alias capture executes framework configuration and plugins. Explicit execution authorization is required.'
    );
  source = await rootDir(source);
  out = path.join(await fs.realpath(path.dirname(path.resolve(out))), path.basename(out));
  if (inside(source, out) || inside(out, source))
    throw Error('Capture output must be outside the original repository.');
  try {
    await fs.lstat(out);
    throw Error('Capture output already exists.');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  let planned = [];
  if (imports) {
    const bytes = await fs.readFile(imports);
    if (bytes.length > 100000) throw Error('Planned imports exceed 100 KB.');
    planned = JSON.parse(bytes);
    if (!Array.isArray(planned) || planned.length > 1000)
      throw Error('Expected at most 1000 planned import pairs.');
    for (const item of planned) {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        throw Error('Invalid planned import pair.');
      relativeFile(item.importer);
      if (
        typeof item.specifier !== 'string' ||
        !/^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/.test(item.specifier) ||
        item.specifier.split('/').some((x) => !x || x === '.' || x === '..')
      )
        throw Error('Planned imports must be literal package specifiers.');
      if (Object.keys(item).some((k) => !['importer', 'specifier'].includes(k)))
        throw Error('Invalid planned import pair.');
    }
  }
  const files = await inventory(source);
  if (Object.keys(files).some((f) => f.startsWith(virtualDirectory + '/')))
    throw Error('Reserved virtual module output already exists.');
  if (files[captureFile] || files['portsmith.aliases.json'])
    throw Error(
      'Capture requires an original configuration without an existing explicit/captured alias map.'
    );
  const stage = await fs.mkdtemp(path.join(path.dirname(out), '.portsmith-alias-capture-'));
  try {
    await copyInventory(source, stage, files);
    const dirs = await dependencyDirectories(source);
    if (!dirs.length)
      throw Error('Install the repository dependencies in a reviewed copy before capturing aliases.');
    await validateDependencyLinks(source, dirs);
    for (const dir of dirs) {
      await fs.mkdir(path.dirname(path.join(stage, dir)), { recursive: true });
      await fs.cp(path.join(source, dir), path.join(stage, dir), {
        recursive: true,
        dereference: false,
        verbatimSymlinks: true,
        mode: constants.COPYFILE_FICLONE
      });
    }
    await validateDependencyLinks(stage, dirs);
    const r = await runProcess(
      process.execPath,
      [
        fileURLToPath(new URL('../providers/vite/capture-worker.mjs', import.meta.url)),
        mode,
        JSON.stringify(planned),
        String(virtualModules)
      ],
      { cwd: stage, protocol: true, timeoutMs, maxOutputBytes: 4000000 }
    );
    if (r.exitCode !== 0 || r.reason)
      throw Error(
        'Vite alias capture failed (' +
          (r.reason ?? 'exit ' + r.exitCode) +
          '). Check installed Vite/config compatibility; config logs are not retained because they may contain credentials.'
      );
    if (!same(files, await inventory(stage)) || !same(files, await inventory(source)))
      throw Error('Alias capture changed repository files; no snapshot was published.');
    const receipt = JSON.parse(r.protocol);
    const manifest = JSON.parse(await fs.readFile(path.join(stage, 'package.json'), 'utf8'));
    const layout = await workspaceLayout(stage, manifest);
    for (const query of planned) {
      const owner = [...layout.packages]
        .sort((a, b) => (a.dir === '.' ? 1 : b.dir === '.' ? -1 : b.dir.length - a.dir.length))
        .find((p) => p.dir === '.' || query.importer.startsWith(p.dir + '/')).manifest;
      const declared = {
        ...owner.dependencies,
        ...owner.devDependencies,
        ...owner.peerDependencies,
        ...owner.optionalDependencies
      };
      const record = receipt.records.find(
        (r) => r.importer === query.importer && r.specifier === query.specifier
      );
      if (!record || !['local', 'external'].includes(record.kind))
        throw Error(
          `Planned import ${query.specifier} in ${query.importer} did not resolve; install/configure it before capture.`
        );
      const name = query.specifier.startsWith('@')
        ? query.specifier.split('/').slice(0, 2).join('/')
        : query.specifier.split('/')[0];
      if (record.kind === 'external' && !Object.hasOwn(declared, name))
        throw Error(
          `Planned package ${name} is undeclared; add and install it in a reviewed copy before capture.`
        );
    }
    for (const item of receipt.generated ?? []) {
      if (
        !new RegExp('^' + virtualDirectory + '/[a-f0-9]{32}\\.mjs$').test(item.path) ||
        typeof item.content !== 'string' ||
        hash(item.content) !== item.sha256
      )
        throw Error('Invalid generated virtual module.');
      const dest = await safePath(stage, item.path, { missing: true });
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, item.content, { flag: 'wx' });
      delete item.content;
    }
    receipt.execution = { durationMs: r.durationMs, outputSha256: hash(r.stdout + r.stderr) };
    await saveJson(path.join(stage, captureFile), receipt);
    await capturedAliases(stage);
    // mkdir is the publication reservation; an existing user path is never replaced.
    await fs.mkdir(out, { mode: 0o700 });
    try {
      for (const entry of await fs.readdir(stage))
        await fs.rename(path.join(stage, entry), path.join(out, entry));
    } catch (e) {
      await fs.rm(out, { recursive: true, force: true });
      throw e;
    }
    return {
      status: 'captured',
      source: out,
      original: source,
      mode,
      records: receipt.records.length,
      local: receipt.records.filter((x) => x.kind === 'local').length,
      virtualModules: (receipt.generated ?? []).length,
      plannedImports: planned.length,
      unsupported: receipt.records.filter((x) => !['local', 'external'].includes(x.kind)).length,
      receipt: path.join(out, captureFile),
      next:
        'Use this copy with --aliases. Freeze runtime.aliases' +
        (receipt.generated?.length || planned.length ? ' and runtime.capturedImports' : '') +
        ' plus a production build check before prepare. Add other package import pairs with --imports before freezing a new run.'
    };
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}
