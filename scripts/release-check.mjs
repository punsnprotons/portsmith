import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { releaseInventory, copyRelease, sha256 } from './release-files.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const clean = process.argv.includes('--clean');
if (process.argv.slice(2).some((a) => a !== '--clean')) throw Error('Usage: release-check.mjs [--clean]');
await fs.mkdir(path.join(project, '.portsmith'), { recursive: true });
const out = await fs.mkdtemp(path.join(project, '.portsmith', 'alpha-release-'));
const inventory = await releaseInventory(project);
const proof = {
  version: 1,
  started: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  clean,
  files: inventory,
  steps: [],
  status: 'running'
};
const save = () => fs.writeFile(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
await save();
console.log(`Release evidence: ${out}`);
// Do not inherit provider keys, user npm credentials, NODE_PATH, or NODE_OPTIONS.
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'portsmith-alpha-'));
const home = path.join(work, 'home'),
  cache = path.join(work, 'npm-cache');
await fs.mkdir(home);
const env = {
  PATH: process.env.PATH,
  HOME: home,
  TMPDIR: process.env.TMPDIR || '/tmp',
  CI: 'true',
  COPYFILE_DISABLE: '1',
  npm_config_cache: cache,
  npm_config_userconfig: path.join(home, '.npmrc'),
  npm_config_update_notifier: 'false',
  npm_config_audit: 'false',
  npm_config_fund: 'false'
};
if (process.env.PLAYWRIGHT_BROWSERS_PATH) env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH;
else env.PLAYWRIGHT_BROWSERS_PATH = path.join(work, 'browsers');
async function run(name, command, args, cwd, extra = {}) {
  console.log(`Checking ${name}…`);
  const log = path.join(out, `${name}.log`),
    chunks = [];
  const result = await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGTERM'), 15 * 60 * 1000);
    child.stdout.on('data', (b) => chunks.push(b));
    child.stderr.on('data', (b) => chunks.push(b));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  const bytes = Buffer.concat(chunks);
  await fs.writeFile(log, bytes);
  proof.steps.push({ name, ...result, log: path.basename(log), sha256: sha256(bytes) });
  await save();
  if (result.code !== 0 || result.signal) throw Error(`${name} failed. See ${log}`);
  return bytes.toString();
}
let checkout;
try {
  const relative = path.relative(project, work);
  assert(
    relative.startsWith('..' + path.sep) || path.isAbsolute(relative),
    'Clean workspace must be outside the checkout'
  );
  for (let ancestor = work; ; ancestor = path.dirname(ancestor)) {
    try {
      await fs.lstat(path.join(ancestor, 'node_modules'));
      throw Error('Clean workspace has an ancestor node_modules directory: ' + ancestor);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (path.dirname(ancestor) === ancestor) break;
  }
  proof.isolation = {
    externalWorkspace: true,
    ancestorDependencies: false,
    inheritedNodePath: false,
    browserCache: process.env.PLAYWRIGHT_BROWSERS_PATH ? 'supplied' : 'fresh'
  };
  checkout = path.join(work, 'source');
  await copyRelease(project, checkout, inventory);
  const pkg = JSON.parse(await fs.readFile(path.join(checkout, 'package.json')));
  assert.equal(pkg.private, true, 'Publishing must remain disabled');
  assert.match(pkg.version, /-alpha\.\d+$/);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(checkout, 'package-lock.json'))).packages[''].version,
    pkg.version
  );
  if (clean) {
    await run('clean-install', 'npm', ['ci', '--ignore-scripts'], checkout);
    await run('browser-install', 'node', ['node_modules/playwright/cli.js', 'install', 'chromium'], checkout);
    await run('clean-check', 'npm', ['run', 'check'], checkout);
    await run('clean-demo', 'npm', ['run', 'demo'], checkout);
    await run('clean-browser-demo', 'npm', ['run', 'demo:browser'], checkout);
  }
  await run('dependency-audit', 'node', ['scripts/audit-dependencies.mjs'], checkout, {
    PORTSMITH_AUDIT_OUTPUT: path.join(out, 'audit.json')
  });
  // npm pack ignores lifecycle hooks; pack from the allowlisted source copy.
  await run('pack', 'npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', out], checkout);
  const tarball = path.join(out, `${pkg.name}-${pkg.version}.tgz`);
  const unpack = path.join(work, 'unpack');
  await fs.mkdir(unpack);
  await run('unpack', 'tar', ['-xzf', tarball, '-C', unpack], out);
  const packed = path.join(unpack, 'package');
  const packedFiles = await releaseInventory(packed, await fs.readdir(packed));
  for (const [file, hash] of Object.entries(packedFiles)) {
    assert.equal(hash, inventory[file], `Package differs from reviewed source: ${file}`);
    assert(!file.startsWith('scripts/') || pkg.files.includes(file), `Internal script packed: ${file}`);
  }
  const consumer = path.join(work, 'consumer');
  await fs.mkdir(consumer);
  await fs.writeFile(path.join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
  await run('consumer-install', 'npm', ['install', '--ignore-scripts', '--omit=dev', tarball], consumer);
  await run('consumer-audit', 'npm', ['audit', '--omit=dev', '--audit-level=low', '--json'], consumer);
  const installed = path.join(consumer, 'node_modules', pkg.name);
  assert.deepEqual(await releaseInventory(installed, await fs.readdir(installed)), packedFiles);
  const cli = path.join(consumer, 'node_modules', '.bin', 'portsmith');
  assert.equal((await run('cli-version', cli, ['--version'], consumer)).trim(), pkg.version);
  await run('cli-help', cli, ['--help'], consumer);
  const doctor = JSON.parse(await run('doctor', cli, ['doctor', '--json'], consumer));
  assert.equal(doctor.status, 'ready');
  const discover = JSON.parse(
    await run(
      'discovery',
      cli,
      ['discover', '--source', path.join(installed, 'examples/source'), '--query', 'filter', '--json'],
      consumer
    )
  );
  assert(discover.candidates.length > 0);
  await run(
    'initialize',
    cli,
    ['init', '--out', path.join(consumer, 'model-setup'), '--model', 'YOUR_MODEL_ID'],
    consumer
  );
  await run(
    'api-import',
    'node',
    [
      '--input-type=module',
      '-e',
      `import {executeCommand} from '${pkg.name}'; if(typeof executeCommand!=='function') throw Error('API export missing')`
    ],
    consumer
  );
  await run('installed-demo', 'node', [path.join(installed, 'scripts/demo.mjs')], consumer);
  if (clean)
    await run('installed-browser-demo', 'node', [path.join(installed, 'scripts/demo-browser.mjs')], consumer);
  // Generated evidence/dependencies cannot enter the source archive.
  const sourceList = path.join(out, 'source-files.txt');
  await fs.writeFile(sourceList, Object.keys(inventory).join('\n') + '\n');
  const sourceArchive = path.join(out, `${pkg.name}-${pkg.version}-source.tgz`);
  await run(
    'source-archive',
    'tar',
    [
      ...(process.platform === 'darwin' ? ['--no-xattrs'] : []),
      '-czf',
      sourceArchive,
      '-C',
      checkout,
      '-T',
      sourceList
    ],
    out
  );
  const extracted = path.join(work, 'source-replay');
  await fs.mkdir(extracted);
  await run('source-replay', 'tar', ['-xzf', sourceArchive, '-C', extracted], out);
  assert.deepEqual(
    await releaseInventory(extracted),
    inventory,
    'Source archive did not reproduce the release'
  );
  assert.deepEqual(await releaseInventory(project), inventory, 'Source changed during release checks');
  proof.artifacts = {};
  for (const artifact of [tarball, sourceArchive])
    proof.artifacts[path.basename(artifact)] = sha256(await fs.readFile(artifact));
  proof.packedFiles = packedFiles;
  proof.status = 'passed';
} catch (error) {
  proof.status = 'failed';
  proof.error = error.message;
  process.exitCode = 1;
} finally {
  proof.finished = new Date().toISOString();
  await save();
  // Keep archives, logs, hashes and audit; discard only copies made by this run.
  await fs.rm(work, { recursive: true, force: true });
  console.log(`${proof.status}: ${path.join(out, 'proof.json')}`);
  if (proof.error) console.error(proof.error);
}
