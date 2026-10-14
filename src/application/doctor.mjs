import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { workspaceLayout, dependencyDirectories } from '../providers/dependencies/workspaces.mjs';
import { modelConfig } from '../providers/model/client.mjs';
import { rootDir, readJson, safePath } from '../platform/files.mjs';
import { runProcess } from '../platform/process.mjs';

export async function doctor({ workspace = process.cwd(), config, target, browser = false } = {}) {
  const checks = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({
    id: 'node',
    status: major >= 22 ? 'passed' : 'failed',
    value: process.version,
    remediation: major >= 22 ? null : 'Install Node 22.19+ or 24.11+.'
  });
  const git = await runProcess('git', ['--version'], { cwd: os.tmpdir(), timeoutMs: 3000 });
  checks.push({
    id: 'git',
    status: git.exitCode === 0 && !git.reason ? 'passed' : 'failed',
    value: git.stdout.trim(),
    remediation: git.exitCode === 0 ? null : 'Install Git and add it to PATH.'
  });
  let temporary;
  try {
    workspace = await rootDir(workspace);
    temporary = await fs.mkdtemp(path.join(workspace, '.portsmith-doctor-'));
    await fs.writeFile(path.join(temporary, 'probe'), 'ok', { flag: 'wx', mode: 0o600 });
    checks.push({ id: 'workspace', status: 'passed', value: workspace, remediation: null });
  } catch (error) {
    checks.push({
      id: 'workspace',
      status: 'failed',
      value: error.message,
      remediation: 'Choose an existing writable workspace with --workspace DIR.'
    });
  } finally {
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  }
  if (config) {
    try {
      const settings = modelConfig(await readJson(config));
      checks.push({
        id: 'model-config',
        status: 'passed',
        value: 'Valid OpenAI-compatible configuration',
        remediation: null
      });
      const present = Boolean(process.env[settings.apiKeyEnv]?.trim());
      checks.push({
        id: 'model-key',
        status: present ? 'passed' : 'failed',
        value: present
          ? 'Present in process environment (value hidden)'
          : 'Not loaded into process environment',
        remediation: present
          ? null
          : 'Add your key to a private .env and run portsmith --env .env doctor. The CLI only loads it when explicitly requested; values are never printed.'
      });
    } catch {
      checks.push({
        id: 'model-config',
        status: 'failed',
        value: 'Missing or invalid model configuration',
        remediation: 'Run schema --command model; use an HTTPS endpoint without embedded credentials.'
      });
    }
  }
  if (browser) {
    const executable = chromium.executablePath();
    let present = false;
    try {
      await fs.access(executable, fs.constants.X_OK);
      present = true;
    } catch {}
    checks.push({
      id: 'chromium',
      status: present ? 'passed' : 'failed',
      value: present
        ? 'Playwright Chromium executable is installed; launch not tested'
        : 'Playwright Chromium is not installed',
      remediation: present
        ? null
        : 'From the Portsmith installation, run npm run browser:install, then retry.'
    });
  }
  let destination = null;
  if (target) {
    try {
      target = await rootDir(target);
      const manifest = await readJson(await safePath(target, 'package.json'));
      const locks = [];
      for (const file of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']) {
        try {
          if ((await fs.lstat(path.join(target, file))).isFile()) locks.push(file);
        } catch {}
      }
      const layout = await workspaceLayout(target, manifest);
      const directories = await dependencyDirectories(target);
      const installed = directories.length > 0;
      const needsDependencies =
        layout.enabled ||
        layout.packages.some(
          (p) =>
            Object.keys({
              ...p.manifest.dependencies,
              ...p.manifest.devDependencies,
              ...p.manifest.optionalDependencies
            }).length > 0
        );
      destination = {
        target,
        nodeEngine: typeof manifest.engines?.node === 'string' ? manifest.engines.node : null,
        packageManager: typeof manifest.packageManager === 'string' ? manifest.packageManager : null,
        lockfiles: locks,
        workspacePackages: layout.members.length,
        dependencyDirectories: directories,
        dependencyDirectoryPresent: installed
      };
      checks.push({
        id: 'destination',
        status: !needsDependencies || installed ? 'passed' : 'failed',
        value: !needsDependencies
          ? 'No dependencies declared in the root or workspace packages'
          : installed
            ? `Dependency directories present (${directories.length}; ${layout.members.length} workspace packages); versions, completeness and runtime compatibility not validated`
            : `Declared dependencies (${layout.members.length} workspace packages) have no local node_modules directories`,
        remediation:
          !needsDependencies || installed
            ? null
            : 'Review repository install scripts and its Node/package-manager requirements, then prepare a run and use dependencies --run DIR followed by install-deps --run DIR --allow-execution. Supported locked npm/pnpm installs disable lifecycle scripts.'
      });
      if (locks.length > 1)
        checks.push({
          id: 'lockfiles',
          status: 'failed',
          value: 'Multiple package-manager lockfiles',
          remediation: 'Choose the repository-supported package manager before provisioning snapshots.'
        });
    } catch {
      checks.push({
        id: 'destination',
        status: 'failed',
        value: 'Cannot inspect the destination package or workspace configuration',
        remediation:
          'Select a JS/TS package root with a valid package.json and supported workspace configuration; preview dependencies on a prepared run for detailed blockers.'
      });
    }
  }
  return {
    destination,
    status: checks.every((c) => c.status === 'passed') ? 'ready' : 'not-ready',
    platform: process.platform,
    architecture: process.arch,
    checks,
    limitations: [
      'Checks are local readiness observations, not provider authentication, dependency compatibility, browser launch or repository behavior proof. Rea and runtime checks are separate.'
    ]
  };
}
