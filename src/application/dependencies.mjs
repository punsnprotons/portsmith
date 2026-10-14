import fs from 'node:fs/promises';
import path from 'node:path';
import { loadRun, assertIntegrity } from './transfer.mjs';
import { hash, readJson, saveJson, safePath, withRunLock } from '../platform/files.mjs';
import {
  workspaceLayout,
  yamlData,
  dependencyDirectories,
  validateDependencyLinks
} from '../providers/dependencies/workspaces.mjs';
import { runProcess } from '../platform/process.mjs';

export async function packagePlan(
  root,
  side,
  { allowMissingLock = false, force = false, sourceRequired = true } = {}
) {
  const blockers = [];
  let manifest = {};
  try {
    manifest = await readJson(await safePath(root, 'package.json'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  let layout;
  try {
    layout = await workspaceLayout(root, manifest);
  } catch (e) {
    if (e.code === 'ENOENT' && !Object.keys(manifest).length)
      layout = { enabled: false, members: [], packages: [{ dir: '.', manifest }], metadata: {} };
    else return { side, status: 'blocked', blockers: [e.message] };
  }
  const required =
    force ||
    (side === 'source'
      ? sourceRequired
      : layout.packages.some(
          (p) =>
            Object.keys({
              ...p.manifest.dependencies,
              ...p.manifest.devDependencies,
              ...p.manifest.optionalDependencies
            }).length > 0
        ) || layout.enabled);
  if (!required)
    return {
      side,
      status: 'not-needed',
      reason: side === 'source' ? 'No traced external source packages' : 'No dependencies declared'
    };
  const locks = [];
  for (const file of [
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
    'npm-shrinkwrap.json'
  ]) {
    try {
      await safePath(root, file);
      if ((await fs.stat(path.join(root, file))).isFile()) locks.push(file);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  if (locks.length !== 1 && !(allowMissingLock && !locks.length))
    blockers.push('Exactly one supported lockfile is required.');
  const manager =
    !locks.length && allowMissingLock
      ? (layout.manager ?? manifest.packageManager?.split('@')[0] ?? 'npm')
      : locks[0] === 'package-lock.json'
        ? 'npm'
        : locks[0] === 'pnpm-lock.yaml'
          ? 'pnpm'
          : null;
  if (!['npm', 'pnpm'].includes(manager))
    blockers.push('Only package-lock.json (npm) and pnpm-lock.yaml (pnpm) are supported.');
  if (layout.manager && manager !== layout.manager)
    blockers.push('Workspace declaration and lockfile use different package managers.');
  const byName = new Map(layout.members.map((p) => [p.name, p]));
  for (const pkg of layout.packages) {
    if (pkg.manifest.pnpm?.patchedDependencies)
      blockers.push('Patched dependencies require a dedicated provisioning adapter.');
    for (const [name, value] of Object.entries({
      ...pkg.manifest.dependencies,
      ...pkg.manifest.devDependencies,
      ...pkg.manifest.optionalDependencies
    })) {
      if (typeof value !== 'string') {
        blockers.push('Invalid dependency specifier.');
        continue;
      }
      if (value.startsWith('workspace:')) {
        if (manager !== 'pnpm' || !byName.has(name) || /[\/]/.test(value.slice(10)))
          blockers.push('Workspace dependency must name a declared local member: ' + name);
      } else if (/^(file:|link:|git|https?:|\.\.?\/|\/)/.test(value))
        blockers.push('Local file, Git and direct URL dependencies require manual provisioning.');
      else if (value.startsWith('catalog:')) {
        const cat = value.slice(8),
          table = cat ? layout.settings?.catalogs?.[cat] : layout.settings?.catalog;
        if (
          manager !== 'pnpm' ||
          typeof table?.[name] !== 'string' ||
          /^(file:|link:|workspace:|git|https?:)/.test(table[name])
        )
          blockers.push('Unresolved or unsupported dependency catalog: ' + name);
      }
    }
  }
  if (manager === 'npm' && locks.length) {
    const lock = await readJson(await safePath(root, locks[0]));
    if (![2, 3].includes(lock.lockfileVersion))
      blockers.push('Only npm lockfile versions 2 and 3 are supported.');
    const inspect = (value) => {
      if (!value || typeof value !== 'object') return;
      if (value.link === true) {
        if (!layout.members.some((p) => p.dir === value.resolved))
          blockers.push('Linked dependency is not a declared workspace member.');
        return;
      }
      if (typeof value.resolved === 'string') {
        try {
          const url = new URL(value.resolved);
          if (
            url.protocol !== 'https:' ||
            url.hostname !== 'registry.npmjs.org' ||
            url.port ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
          )
            blockers.push('Non-public-registry lockfile resolutions require manual provisioning.');
        } catch {
          blockers.push('Local or Git lockfile resolutions require manual provisioning.');
        }
      }
      for (const item of Object.values(value)) if (item && typeof item === 'object') inspect(item);
    };
    inspect(lock.packages);
    inspect(lock.dependencies);
  } else if (manager === 'pnpm' && locks.length) {
    const lock = yamlData(await fs.readFile(await safePath(root, locks[0]), 'utf8'), 'pnpm lockfile');
    const importers = new Set(layout.packages.map((p) => p.dir));
    const approvedLinks = new Set();
    for (const [dir, item] of Object.entries(lock.importers ?? {})) {
      if (!importers.has(dir)) {
        blockers.push('Lockfile importer is outside the declared workspace: ' + dir);
        continue;
      }
      for (const group of ['dependencies', 'devDependencies', 'optionalDependencies'])
        for (const entry of Object.values(item[group] ?? {})) {
          if (typeof entry.version === 'string' && entry.version.startsWith('link:')) {
            const linked = path.posix.normalize(path.posix.join(dir, entry.version.slice(5)));
            if (!layout.members.some((p) => p.dir === linked))
              blockers.push('Lockfile link escapes declared workspace members.');
            else approvedLinks.add(entry);
          }
        }
    }
    const inspect = (value) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        if (['tarball', 'directory', 'patchedDependencies', 'configDependencies'].includes(key))
          blockers.push('Unsupported pnpm lockfile resolution: ' + key);
        if (
          typeof item === 'string' &&
          item.startsWith('link:') &&
          !(key === 'version' && approvedLinks.has(value))
        )
          blockers.push('Linked pnpm resolution is outside a declared workspace importer.');
        if (typeof item === 'string' && /^(file:|git\+|git:|https?:)/.test(item))
          blockers.push('Non-registry pnpm resolution requires manual provisioning.');
        if (item && typeof item === 'object') inspect(item);
      }
    };
    inspect(lock);
  }
  const declared = manifest.packageManager;
  if (
    declared &&
    (typeof declared !== 'string' ||
      !new RegExp('^' + manager + '@\\d+\\.\\d+\\.\\d+(?:\\+sha(?:224|256|384|512)\\.[a-fA-F0-9]+)?$').test(
        declared
      ))
  )
    blockers.push('Declared package manager must match the lockfile with an exact release version.');
  const inputs = { ...layout.metadata };
  for (const file of ['package.json', ...locks])
    inputs[file] = hash(await fs.readFile(await safePath(root, file)));
  return {
    side,
    status: blockers.length ? 'blocked' : 'ready',
    manager,
    workspace: { enabled: layout.enabled, members: layout.members.map(({ dir, name }) => ({ dir, name })) },
    lockfile: locks[0],
    packageManager: declared ?? null,
    nodeEngine: manifest.engines?.node ?? null,
    scriptsDisabled: true,
    inputs,
    blockers
  };
}
export async function dependencyPlan({ run }) {
  const context = await loadRun(run);
  await assertIntegrity(context);
  const sides = [];
  for (const side of ['source', 'baseline', 'candidate'])
    sides.push(
      await packagePlan(path.join(context.run, side), side, {
        sourceRequired: context.state.analysis.externals.some((x) => x.kind !== 'node-builtin')
      })
    );
  return {
    run: context.run,
    status: sides.some((x) => x.status === 'blocked') ? 'blocked' : 'ready',
    sides,
    limitations: [
      'No software is installed by this plan. Installation uses existing package-manager executables, lockfiles and disabled lifecycle scripts.',
      'Patched/local/Git dependencies and private registry authentication are not automatically provisioned.',
      'Dependencies are installed only into copied runs. A successful install does not prove build or runtime behavior.'
    ]
  };
}
export async function installDependencies({
  run,
  allowExecution = false,
  managerBin,
  offline = false,
  timeoutMs = 120000
}) {
  if (!allowExecution) throw Error('Dependency installation requires --allow-execution.');
  return withRunLock(run, async () => {
    const plan = await dependencyPlan({ run });
    if (plan.status !== 'ready')
      throw Error('Dependency plan blocked: ' + plan.sides.flatMap((x) => x.blockers ?? []).join(' '));
    const context = await loadRun(run);
    const receipt = {
      version: 1,
      status: 'installing',
      startedAt: new Date().toISOString(),
      node: process.version,
      scriptsDisabled: true,
      sides: []
    };
    // Even a failed setup attempt invalidates previous execution evidence.
    await saveJson(path.join(plan.run, 'dependencies.json'), receipt);
    for (const item of plan.sides) {
      if (item.status === 'not-needed') {
        receipt.sides.push(item);
        continue;
      }
      const stage = await fs.mkdtemp(path.join(plan.run, '.portsmith-install-'));
      const record = { ...item, status: 'installing' };
      receipt.sides.push(record);
      try {
        const command = managerBin ?? item.manager;
        const probe = await runProcess(command, ['--version'], { cwd: stage, timeoutMs: 5000 });
        const version = probe.stdout.trim();
        if (probe.exitCode !== 0 || probe.reason || !/^\d+\.\d+\.\d+$/.test(version))
          throw Error('Package manager unavailable. Install it separately or pass --manager-bin PATH.');
        if (item.packageManager && item.packageManager.split('+')[0] !== item.manager + '@' + version)
          throw Error('Package-manager version differs from the declared ' + item.packageManager + '.');
        record.managerVersion = version;
        for (const file of Object.keys(item.inputs)) {
          await fs.mkdir(path.dirname(path.join(stage, file)), { recursive: true });
          await fs.copyFile(await safePath(path.join(plan.run, item.side), file), path.join(stage, file));
        }
        await fs.writeFile(path.join(stage, 'empty-user-config'), '');
        await fs.writeFile(path.join(stage, 'empty-global-config'), '');
        const args =
          item.manager === 'npm'
            ? [
                'ci',
                ...(item.workspace.enabled
                  ? ['--workspaces', '--include-workspace-root']
                  : ['--workspaces=false']),
                '--ignore-scripts',
                '--no-audit',
                '--no-fund',
                '--engine-strict',
                '--include=dev',
                '--cache',
                path.join(plan.run, '.portsmith-npm-cache')
              ]
            : [
                'install',
                ...(item.workspace.enabled ? [] : ['--ignore-workspace']),
                '--frozen-lockfile',
                '--ignore-scripts',
                '--ignore-pnpmfile',
                '--config.manage-package-manager-versions=false',
                '--config.engine-strict=true',
                '--store-dir',
                path.join(plan.run, '.portsmith-pnpm-store')
              ];
        const configPrefix = item.manager === 'pnpm' ? '--config.' : '--';
        args.push(
          configPrefix + 'userconfig=' + path.join(stage, 'empty-user-config'),
          configPrefix + 'globalconfig=' + path.join(stage, 'empty-global-config'),
          '--registry=https://registry.npmjs.org'
        );
        if (offline) args.push('--offline');
        const result = await runProcess(command, args, { cwd: stage, timeoutMs, maxOutputBytes: 1000000 });
        // Do not persist raw package-manager logs: URLs and arbitrary registry messages can contain credentials.
        record.execution = {
          command,
          args: args.map((a) => (a.startsWith(stage) ? '<install-stage>' : a)),
          exitCode: result.exitCode,
          reason: result.reason,
          durationMs: result.durationMs,
          outputSha256: hash(result.stdout + result.stderr)
        };
        if (result.exitCode !== 0 || result.reason) {
          const codes = [
            'EBADENGINE',
            'EUSAGE',
            'ENOTFOUND',
            'ETIMEDOUT',
            'ECONNREFUSED',
            'ERR_PNPM_OUTDATED_LOCKFILE',
            'ERR_PNPM_UNSUPPORTED_ENGINE',
            'ERR_PNPM_NO_OFFLINE_TARBALL',
            'ERR_PNPM_LOCKFILE_CONFIG_MISMATCH'
          ];
          record.diagnostic =
            codes.find((code) => (result.stdout + result.stderr).includes(code)) ??
            (result.reason === 'timeout' ? 'timeout' : 'install_failed');
          throw Error(
            'Locked install failed (' +
              record.diagnostic +
              '). Check the lockfile, Node engine, registry access and package-manager version; lifecycle scripts remain disabled.'
          );
        }
        for (const file of Object.keys(item.inputs))
          if (hash(await fs.readFile(path.join(stage, file))) !== item.inputs[file])
            throw Error('Installer changed the manifest or lockfile.');
        const directories = await dependencyDirectories(stage);
        if (!directories.length) throw Error('Installer did not produce dependency directories.');
        const allowed = new Set([
          'node_modules',
          ...item.workspace.members.map((p) => p.dir + '/node_modules')
        ]);
        if (directories.some((dir) => !allowed.has(dir)))
          throw Error('Installer produced dependencies outside declared packages.');
        await validateDependencyLinks(stage, directories);
        await assertIntegrity(context);
        const sideRoot = path.join(plan.run, item.side),
          old = await dependencyDirectories(sideRoot);
        if (old.some((dir) => !allowed.has(dir)))
          throw Error('Existing dependencies outside declared workspace; use a fresh run.');
        const backupRoot = await fs.mkdtemp(path.join(plan.run, '.portsmith-backup-')),
          moved = [],
          published = [];
        let cleanupBackup = false;
        try {
          for (const dir of old) {
            await fs.mkdir(path.dirname(path.join(backupRoot, dir)), { recursive: true });
            await fs.rename(path.join(sideRoot, dir), path.join(backupRoot, dir));
            moved.push(dir);
          }
          for (const dir of directories) {
            await fs.rename(path.join(stage, dir), path.join(sideRoot, dir));
            published.push(dir);
          }
          cleanupBackup = true;
        } catch (error) {
          for (const dir of published.reverse())
            await fs.rename(path.join(sideRoot, dir), path.join(stage, dir));
          for (const dir of moved.reverse())
            await fs.rename(path.join(backupRoot, dir), path.join(sideRoot, dir));
          cleanupBackup = true;
          throw error;
        } finally {
          if (cleanupBackup) await fs.rm(backupRoot, { recursive: true, force: true });
        }
        record.directories = directories;
        record.status = 'installed';
      } catch (e) {
        record.status = 'failed';
        record.error = e.message;
        receipt.status = 'failed';
        await saveJson(path.join(plan.run, 'dependencies.json'), receipt);
        throw e;
      } finally {
        await fs.rm(stage, { recursive: true, force: true });
      }
      await saveJson(path.join(plan.run, 'dependencies.json'), receipt);
    }
    await assertIntegrity(context);
    receipt.status = 'installed';
    receipt.completedAt = new Date().toISOString();
    await saveJson(path.join(plan.run, 'dependencies.json'), receipt);
    return {
      ...receipt,
      run: plan.run,
      next: 'Run verify or auto-adapt. Lifecycle scripts were disabled; declared build/type checks must still pass.'
    };
  });
}
