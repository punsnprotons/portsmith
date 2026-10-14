import fs from 'node:fs/promises';
import path from 'node:path';
import { setupPatch } from '../providers/dependencies/setup-patch.mjs';
import { discoverImports } from './package-imports.mjs';
import { packagePlan } from './dependencies.mjs';
import { captureAliases } from './capture-aliases.mjs';
import { dependencyDirectories, validateDependencyLinks } from '../providers/dependencies/workspaces.mjs';
import {
  rootDir,
  inside,
  inventory,
  copyInventory,
  same,
  hash,
  readJson,
  saveJson
} from '../platform/files.mjs';
import { runProcess } from '../platform/process.mjs';

export async function setupDependencies({
  source,
  out,
  proposal,
  dependencySource,
  capture = false,
  virtualModules = false,
  managerBin,
  cache,
  offline = false,
  allowExecution = false,
  timeoutMs = 120000
}) {
  if (virtualModules && !capture) throw Error('--virtual-modules requires --capture during setup.');
  if (!allowExecution) throw Error('Dependency setup requires --allow-execution.');
  source = await rootDir(source);
  out = path.join(await fs.realpath(path.dirname(path.resolve(out))), path.basename(out));
  if (inside(source, out) || inside(out, source))
    throw Error('Setup output must be outside the original repository.');
  try {
    await fs.lstat(out);
    throw Error('Setup output already exists.');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (cache) {
    cache = await rootDir(cache);
    if (inside(source, cache) || inside(out, cache)) throw Error('Cache must be outside source and output.');
  }
  const original = await inventory(source);
  if (
    [
      'portsmith.resolved-aliases.json',
      'portsmith.setup.json',
      'portsmith.setup.patch',
      'portsmith.imports.json'
    ].some((f) => original[f])
  )
    throw Error('Setup requires an uncaptured repository; create a new run after setup.');
  const discovery = await discoverImports({ source, proposal, dependencySource });
  if (discovery.status !== 'ready') throw Error('Import discovery blocked: ' + discovery.blockers.join(' '));
  const stage = await fs.mkdtemp(path.join(path.dirname(out), '.portsmith-setup-'));
  const repo = path.join(stage, 'repository'),
    install = path.join(stage, 'install');
  try {
    await copyInventory(source, repo, original);
    for (const addition of discovery.additions) {
      const file = path.join(repo, addition.manifest),
        manifest = await readJson(file);
      manifest.dependencies = { ...manifest.dependencies, [addition.name]: addition.range };
      await saveJson(file, manifest);
    }
    const plan = await packagePlan(repo, 'setup', { force: true, allowMissingLock: true });
    if (plan.status !== 'ready') throw Error('Dependency setup blocked: ' + plan.blockers.join(' '));
    await fs.mkdir(install);
    for (const file of Object.keys(plan.inputs)) {
      await fs.mkdir(path.dirname(path.join(install, file)), { recursive: true });
      await fs.copyFile(path.join(repo, file), path.join(install, file));
    }
    const command = managerBin ?? plan.manager;
    const probe = await runProcess(command, ['--version'], { cwd: install, timeoutMs: 5000 });
    const version = probe.stdout.trim();
    if (probe.exitCode !== 0 || probe.reason || !/^\d+\.\d+\.\d+$/.test(version))
      throw Error('Package manager unavailable; use --manager-bin.');
    if (plan.packageManager && plan.packageManager.split('+')[0] !== plan.manager + '@' + version)
      throw Error('Package-manager version differs from ' + plan.packageManager);
    const userConfig = path.join(stage, 'empty-user-config'),
      globalConfig = path.join(stage, 'empty-global-config');
    await fs.writeFile(userConfig, '');
    await fs.writeFile(globalConfig, '');
    const prefix = plan.manager === 'npm' ? '--' : '--config.';
    const flags = [
      '--ignore-scripts',
      '--registry=https://registry.npmjs.org',
      prefix + 'userconfig=' + userConfig,
      prefix + 'globalconfig=' + globalConfig,
      ...(offline ? ['--offline'] : []),
      ...(plan.manager === 'npm'
        ? [
            '--no-audit',
            '--no-fund',
            '--engine-strict',
            '--include=dev',
            '--cache',
            cache ?? path.join(stage, 'cache'),
            ...(plan.workspace.enabled
              ? ['--workspaces', '--include-workspace-root']
              : ['--workspaces=false'])
          ]
        : [
            '--ignore-pnpmfile',
            '--config.manage-package-manager-versions=false',
            '--config.engine-strict=true',
            '--store-dir',
            cache ?? path.join(stage, 'store'),
            ...(plan.workspace.enabled ? [] : ['--ignore-workspace'])
          ])
    ];
    const executions = [];
    async function execute(args, phase) {
      const result = await runProcess(command, [...args, ...flags], {
        cwd: install,
        timeoutMs,
        maxOutputBytes: 1000000
      });
      executions.push({
        phase,
        exitCode: result.exitCode,
        reason: result.reason ? 'process-failure' : null,
        durationMs: result.durationMs,
        outputSha256: hash(result.stdout + result.stderr)
      });
      if (result.exitCode !== 0 || result.reason) {
        const diagnostic =
          [
            'EUSAGE',
            'EBADENGINE',
            'ERESOLVE',
            'ENOTFOUND',
            'ETIMEDOUT',
            'ENOSPC',
            'ENOTCACHED',
            'ERR_PNPM_NO_OFFLINE_TARBALL'
          ].find((c) => (result.stdout + result.stderr).includes(c)) ?? 'setup_failed';
        const error = Error(
          `Dependency ${phase} failed (${diagnostic}); check Node, manager version and registry access. No output published.`
        );
        error.diagnostic = diagnostic;
        throw error;
      }
    }
    const manifests = Object.fromEntries(
      Object.entries(plan.inputs).filter(([f]) => f.endsWith('package.json') || f === 'pnpm-workspace.yaml')
    );
    // Existing locks stay frozen unless a declared addition requires resolution.
    if (!plan.lockfile || discovery.additions.length)
      await execute(
        plan.manager === 'npm'
          ? ['install', '--package-lock-only']
          : ['install', '--lockfile-only', '--no-frozen-lockfile'],
        'resolve'
      );
    for (const [file, sha] of Object.entries(manifests))
      if (hash(await fs.readFile(path.join(install, file))) !== sha)
        throw Error('Dependency resolver changed a manifest.');
    let locked;
    const recoveries = [];
    async function lockedInstall() {
      locked = await packagePlan(install, 'setup', { force: true });
      if (locked.status !== 'ready')
        throw Error('Resolved dependency plan blocked: ' + locked.blockers.join(' '));
      await execute(plan.manager === 'npm' ? ['ci'] : ['install', '--frozen-lockfile'], 'install');
      for (const [file, sha] of Object.entries(locked.inputs))
        if (hash(await fs.readFile(path.join(install, file))) !== sha)
          throw Error('Locked installer changed an input.');
    }
    try {
      await lockedInstall();
    } catch (error) {
      // npm can preserve inconsistent transitive optional entries when updating old locks.
      // Only a pre-freeze resolution with actual additions may resolve once more; frozen installs never do.
      if (plan.manager !== 'npm' || error.diagnostic !== 'EUSAGE' || !discovery.additions.length) throw error;
      recoveries.push({
        reason: 'npm-generated-lock-rejected-by-ci',
        previousLockSha256: hash(await fs.readFile(path.join(install, 'package-lock.json')))
      });
      await execute(['install', '--package-lock-only'], 'resolve-retry');
      for (const [file, sha] of Object.entries(manifests))
        if (hash(await fs.readFile(path.join(install, file))) !== sha)
          throw Error('Dependency resolver changed a manifest.');
      await lockedInstall();
    }
    const directories = await dependencyDirectories(install);
    let needsDependencies = false;
    for (const file of Object.keys(manifests).filter((f) => f.endsWith('package.json'))) {
      const m = await readJson(path.join(install, file));
      needsDependencies ||=
        Object.keys({
          ...m.dependencies,
          ...m.devDependencies,
          ...m.optionalDependencies,
          ...m.peerDependencies
        }).length > 0;
    }
    if (needsDependencies && !directories.length)
      throw Error('Installer did not produce dependency directories.');
    const allowed = new Set([
      'node_modules',
      ...locked.workspace.members.map((p) => p.dir + '/node_modules')
    ]);
    if (directories.some((d) => !allowed.has(d))) throw Error('Dependencies outside declared workspaces.');
    await validateDependencyLinks(install, directories);
    for (const file of Object.keys(locked.inputs))
      await fs.copyFile(path.join(install, file), path.join(repo, file));
    for (const dir of directories) {
      await fs.mkdir(path.dirname(path.join(repo, dir)), { recursive: true });
      await fs.rename(path.join(install, dir), path.join(repo, dir));
    }
    const pairs = discovery.records.map(({ importer, specifier }) => ({ importer, specifier }));
    const importsFile = path.join(stage, 'imports.json');
    await saveJson(importsFile, pairs);
    const changes = [];
    for (const file of Object.keys(locked.inputs)) {
      const bytes = await fs.readFile(path.join(repo, file));
      if (hash(bytes) !== original[file]?.sha256)
        changes.push({
          path: file,
          beforeSha256: original[file]?.sha256 ?? null,
          afterSha256: hash(bytes),
          content: bytes.toString('utf8')
        });
    }
    const patch = await setupPatch(stage, source, repo, changes);
    await fs.writeFile(path.join(repo, 'portsmith.setup.patch'), patch);
    // Reviewable setup changes are separate from the later, behavior-verified integration patch.
    const receipt = {
      version: 1,
      status: 'installed',
      original: source,
      originalInventorySha256: hash(JSON.stringify(original)),
      manager: plan.manager,
      managerVersion: version,
      node: process.version,
      scriptsDisabled: true,
      patchSha256: hash(patch),
      discovery,
      inputs: locked.inputs,
      executions,
      recoveries,
      changes,
      behavior: 'not-verified'
    };
    await saveJson(path.join(repo, 'portsmith.setup.json'), receipt);
    await saveJson(path.join(repo, 'portsmith.imports.json'), pairs);
    let publish = repo;
    if (capture) {
      publish = path.join(stage, 'captured');
      await captureAliases({
        source: repo,
        out: publish,
        imports: importsFile,
        virtualModules,
        allowExecution: true,
        timeoutMs
      });
    }
    if (!same(original, await inventory(source))) throw Error('Original repository changed during setup.');
    await fs.mkdir(out, { mode: 0o700 });
    try {
      for (const file of await fs.readdir(publish))
        await fs.rename(path.join(publish, file), path.join(out, file));
    } catch (e) {
      await fs.rm(out, { recursive: true, force: true });
      throw e;
    }
    return {
      status: 'ready',
      source: out,
      original: source,
      additions: discovery.additions,
      imports: pairs.length,
      captured: capture,
      receipt: path.join(out, 'portsmith.setup.json'),
      patch: path.join(out, 'portsmith.setup.patch'),
      next: 'Review portsmith.setup.json, then prepare a NEW run from this copy. Proposed code was not applied; freeze build and behavior checks before adaptation.'
    };
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}
