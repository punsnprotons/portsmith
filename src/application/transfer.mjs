import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { analyze } from '../providers/javascript/analyze.mjs';
import { rewriteAliases, loadAliases } from '../providers/javascript/aliases.mjs';
import { sourceModuleScopes } from '../providers/javascript/module-scopes.mjs';
import { validateContract } from '../contracts/behavior.mjs';
import {
  hash,
  json,
  inside,
  rootDir,
  safePath,
  relativeFile,
  inventory,
  copyInventory,
  readJson,
  saveJson,
  safeWrite,
  assertSnapshot,
  same,
  withRunLock
} from '../platform/files.mjs';
import { runProcess } from '../platform/process.mjs';
import { reaAttachment } from '../providers/rea/client.mjs';
import { regressionFiles, runRegression } from '../providers/node/regression.mjs';
import { dependencyDirectories } from '../providers/dependencies/workspaces.mjs';
import { dependencyReceipt } from '../providers/dependencies/receipt.mjs';
import { PortsmithError } from '../domain/errors.mjs';
import { proposalSchema } from '../contracts/commands.mjs';
import { runBrowser, assertBrowserEvidence } from '../providers/browser/client.mjs';

const runner = fileURLToPath(new URL('../providers/node/runner.mjs', import.meta.url));
export const protectedFile = (rel) =>
  /(^|\/)(__tests__|tests?|specs?|__snapshots__)(\/|$)|\.(test|spec)\.[^/]+$|(^|\/)(?:vite|vitest|webpack|svelte)\.(?:config|workspace|common|dev|prod)\.[^/]+$|(^|\/)(?:tsconfig|jsconfig)(?:\.[^/]+)?\.json$|(^|\/)(portsmith\.(?:setup\.(?:json|patch)|imports\.json)|portsmith\.(?:resolved-)?aliases\.json|package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|bun\.lockb?)$/.test(
    rel
  );
const verificationVersion = (contract) =>
  contract.runtime?.capturedImports
    ? 10
    : contract.runtime?.aliases
      ? 9
      : contract.runtime?.transformTypes
        ? 8
        : contract.runtime
          ? 5
          : contract.checks
            ? 4
            : contract.browser
              ? 3
              : 2;

export async function assertCandidateDependencies(run) {
  try {
    const stat = await fs.lstat(path.join(run, 'candidate', 'node_modules'));
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new PortsmithError(
        'unsupported_dependencies',
        'Candidate node_modules must be a real directory.',
        'Install or copy the locked dependencies into candidate/node_modules. Do not link the root dependency directory.'
      );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await dependencyDirectories(path.join(run, 'candidate'));
  } catch (error) {
    throw new PortsmithError(
      'unsupported_dependencies',
      error.message,
      'Install dependencies into real directories inside the copied workspace.'
    );
  }
}

export async function prepare({ source, target, entry, mount, contract: contractFile, out, aliases }) {
  const contract = validateContract(await readJson(contractFile));
  if (aliases && !contract.runtime?.aliases)
    throw Error('Alias preparation requires runtime.aliases in the frozen contract.');
  aliases = contract.runtime?.aliases ?? false;
  const analysis = await analyze({ source, target, entry, mount, aliases });
  if (analysis.blockers.length)
    throw new PortsmithError(
      'analysis_blocked',
      `Preparation blocked:\n${analysis.blockers.join('\n')}`,
      'Run plan, resolve the listed source/import/dependency blockers, then prepare a fresh run.',
      { blockers: analysis.blockers }
    );
  if (contract.source.module !== entry)
    throw new Error('Contract source module must match the traced entry.');
  await safePath(analysis.target, contract.target.module);
  if (aliases) {
    const configs = await Promise.all([loadAliases(analysis.source), loadAliases(analysis.target)]);
    if (
      configs.some((c) => c.captured?.generated?.length || c.captured?.plannedImports?.length) &&
      !contract.runtime?.capturedImports
    )
      throw Error(
        'Generated modules and planned imports require runtime.capturedImports in a new frozen contract (verification version 10).'
      );
    if (configs.some((c) => c.captured) && !contract.checks?.length)
      throw Error('Captured aliases require a declared production build check in the frozen contract.');
  }
  const parent = await rootDir(path.dirname(path.resolve(out)));
  const run = path.join(parent, path.basename(out));
  if ([analysis.source, analysis.target].some((root) => inside(root, run) || inside(run, root)))
    throw new Error('Run directory must be outside both repositories.');
  const sourceSnapshot = await inventory(analysis.source);
  const targetSnapshot = await inventory(analysis.target);
  // A .js file must not inherit an unrelated destination's package "type".
  // Preserve only format boundaries, never source install scripts or dependencies.
  const moduleScopes = await sourceModuleScopes(analysis);
  for (const scope of moduleScopes) {
    const destination = `${analysis.mount}/${scope.path}`;
    await safePath(analysis.target, destination, { missing: true });
    if (targetSnapshot[destination]) throw new Error(`Feature would overwrite destination: ${destination}`);
  }
  const copied = [...analysis.files, ...analysis.license.files];
  const unique = [...new Map(copied.map((file) => [file.path, file])).values()];
  for (const file of unique) {
    const destination = `${analysis.mount}/${file.path}`;
    await safePath(analysis.target, destination, { missing: true });
    if (targetSnapshot[destination]) throw new Error(`Feature would overwrite destination: ${destination}`);
  }
  await fs.mkdir(run, { mode: 0o700 }); // Never reuse or overwrite an existing run.
  try {
    for (const name of ['source', 'baseline', 'candidate'])
      await fs.mkdir(path.join(run, name), { mode: 0o700 });
    await copyInventory(analysis.source, path.join(run, 'source'), sourceSnapshot);
    await copyInventory(analysis.target, path.join(run, 'baseline'), targetSnapshot);
    await copyInventory(analysis.target, path.join(run, 'candidate'), targetSnapshot);
    const featureFiles = {};
    for (const file of unique) {
      let bytes = await fs.readFile(await safePath(analysis.source, file.path));
      if (hash(bytes) !== file.sha256) throw new Error(`Source changed after analysis: ${file.path}`);
      const edits = analysis.aliases?.rewrites.filter((r) => r.path === file.path) ?? [];
      if (edits.length) bytes = Buffer.from(rewriteAliases(bytes.toString('utf8'), edits));
      featureFiles[`${analysis.mount}/${file.path}`] = { sha256: hash(bytes), executable: false };
      const dest = path.join(run, 'candidate', analysis.mount, file.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, bytes, { flag: 'wx', mode: 0o600 });
    }
    for (const scope of moduleScopes) {
      const dest = path.join(run, 'candidate', analysis.mount, scope.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, json(scope.content), { flag: 'wx', mode: 0o600 });
    }
    const attributionPath = `${analysis.mount}/PORTSMITH_PROVENANCE.json`;
    await fs.writeFile(
      path.join(run, 'candidate', attributionPath),
      json({
        source: analysis.source,
        entry,
        license: analysis.license,
        files: analysis.files,
        moduleScopes,
        virtualModules: analysis.aliases?.captured?.generated ?? [],
        aliasRewrites: analysis.aliases?.rewrites ?? [],
        note: 'Source snapshots are unchanged. Recorded alias literals may become relative imports in the immutable extracted copy. Preserved root license notices. Review per-file terms and redistribution obligations.'
      }),
      { flag: 'wx', mode: 0o600 }
    );
    await saveJson(path.join(run, 'contract.json'), contract);
    const state = {
      version: 1,
      createdAt: new Date().toISOString(),
      analysis,
      contractSha256: hash(json(contract)),
      sourceSnapshot,
      targetSnapshot,
      generatedFiles: {
        ...featureFiles,
        ...Object.fromEntries(
          moduleScopes.map((scope) => [
            `${analysis.mount}/${scope.path}`,
            { sha256: hash(json(scope.content)), executable: false }
          ])
        )
      },
      limitations: [
        ...analysis.limitations,
        'Execution uses a separate host process, not a security sandbox. Only run code you trust.',
        'Verification covers only the declared behavior, regression tests, browser cases and additional checks.',
        'Snapshots exclude .git, node_modules, .env files, build outputs and coverage. No packages are installed.'
      ]
    };
    await saveJson(path.join(run, 'state.json'), state);
    return {
      run,
      candidate: path.join(run, 'candidate'),
      copiedFiles: unique.length,
      status: 'prepared',
      next: 'Adapt the candidate to the destination, then explicitly authorize verification with --allow-execution.'
    };
  } catch (error) {
    await fs.rm(run, { recursive: true, force: true });
    throw error;
  }
}

export async function loadRun(directory) {
  const run = await rootDir(directory);
  for (const name of ['state.json', 'contract.json', 'source', 'baseline', 'candidate'])
    await safePath(run, name);
  const state = await readJson(path.join(run, 'state.json'));
  if (state.version !== 1) throw new Error('Unsupported transfer version.');
  const bytes = await fs.readFile(path.join(run, 'contract.json'));
  if (hash(bytes) !== state.contractSha256)
    throw new PortsmithError(
      'contract_changed',
      'Frozen contract changed; prepare a new transfer.',
      'Define the corrected contract outside the old run, then prepare a new transfer.'
    );
  const contract = validateContract(JSON.parse(bytes));
  const frozenAliasFiles = contract.runtime?.aliases
    ? (await loadAliases(path.join(run, 'baseline'))).files.map((file) => file.path)
    : [];
  return { run, state, contract, frozenAliasFiles };
}

export async function assertIntegrity({ run, state, contract, frozenAliasFiles = [] }) {
  await assertSnapshot(state.analysis.source, state.sourceSnapshot, 'Original source');
  await assertSnapshot(state.analysis.target, state.targetSnapshot, 'Original destination');
  await assertSnapshot(path.join(run, 'source'), state.sourceSnapshot, 'Source snapshot');
  await assertSnapshot(path.join(run, 'baseline'), state.targetSnapshot, 'Destination baseline');
  const candidate = await inventory(path.join(run, 'candidate'));
  for (const rel of new Set([
    ...Object.keys(state.targetSnapshot),
    ...Object.keys(state.generatedFiles ?? {}),
    ...Object.keys(candidate)
  ])) {
    if (
      (Object.hasOwn(state.generatedFiles ?? {}, rel) ||
        protectedFile(rel) ||
        frozenAliasFiles.includes(rel) ||
        regressionFiles(contract?.regression)?.includes(rel)) &&
      !same(state.generatedFiles?.[rel] ?? state.targetSnapshot[rel], candidate[rel])
    )
      throw new Error(`Destination test files must remain unchanged: ${rel}`);
  }
  return candidate;
}

export async function adaptUnlocked(directory, proposalFile) {
  const context = await loadRun(directory);
  await assertCandidateDependencies(context.run);
  const { run } = context;
  const candidateFiles = await assertIntegrity(context);
  const proposal = proposalSchema.parse(await readJson(proposalFile));
  if (!Array.isArray(proposal.edits) || !proposal.edits.length || proposal.edits.length > 100)
    throw new Error('Proposal requires 1–100 edits.');
  const seen = new Set();
  for (const edit of proposal.edits) {
    relativeFile(edit.path);
    if (seen.has(edit.path)) throw new Error(`Duplicate edit: ${edit.path}`);
    seen.add(edit.path);
    if (
      protectedFile(edit.path) ||
      context.frozenAliasFiles.includes(edit.path) ||
      Object.hasOwn(context.state.generatedFiles ?? {}, edit.path) ||
      regressionFiles(context.contract.regression)?.includes(edit.path)
    )
      throw new Error(`Cannot edit regression tests or verification configuration: ${edit.path}`);
    if (typeof edit.content !== 'string' || Buffer.byteLength(edit.content) > 2_000_000)
      throw new Error(`Invalid edit content: ${edit.path}`);
    if (edit.beforeSha256 !== (candidateFiles[edit.path]?.sha256 ?? null))
      throw new Error(`Stale edit: ${edit.path}`);
    await safePath(path.join(run, 'candidate'), edit.path, { missing: true });
  }
  const staging = path.join(run, `.candidate-${crypto.randomUUID()}`);
  const backup = path.join(run, `.previous-${crypto.randomUUID()}`);
  await fs.mkdir(staging, { mode: 0o700 });
  try {
    await copyInventory(path.join(run, 'candidate'), staging, candidateFiles);
    for (const edit of proposal.edits) {
      const dest = path.join(staging, edit.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, edit.content, { mode: 0o600 });
    }
    await assertSnapshot(path.join(run, 'candidate'), candidateFiles, 'Candidate during adaptation');
    await fs.rename(path.join(run, 'candidate'), backup);
    const dependenciesMoved = [];
    try {
      for (const dir of await dependencyDirectories(backup)) {
        await fs.mkdir(path.dirname(path.join(staging, dir)), { recursive: true });
        await fs.rename(path.join(backup, dir), path.join(staging, dir));
        dependenciesMoved.push(dir);
      }
      await fs.rename(staging, path.join(run, 'candidate'));
    } catch (error) {
      for (const dir of dependenciesMoved.reverse())
        await fs.rename(path.join(staging, dir), path.join(backup, dir));
      await fs.rename(backup, path.join(run, 'candidate'));
      throw error;
    }
    await fs.rm(backup, { recursive: true });
    return { status: 'adapted', edited: proposal.edits.map((e) => e.path), verification: 'required' };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

async function behavior(run, side, timeoutMs, runtime) {
  const execution = await runProcess(
    process.execPath,
    [
      ...(runtime?.transformTypes ? ['--experimental-transform-types'] : []),
      runner,
      path.join(run, 'contract.json'),
      side === 'source' ? 'source' : 'target'
    ],
    {
      cwd: path.join(run, side),
      protocol: true,
      timeoutMs
    }
  );
  let result;
  try {
    result = JSON.parse(execution.protocol);
  } catch {
    result = { status: 'error', error: 'No valid result from contract runner.' };
  }
  delete execution.protocol;
  if (execution.exitCode !== 0 || execution.reason)
    result = { status: 'error', error: execution.reason ?? `Process exited ${execution.exitCode}` };
  return { ...result, execution };
}

export async function verifyUnlocked(directory, { allowExecution = false, timeoutMs = 10000 } = {}) {
  if (allowExecution !== true)
    throw new Error(
      'Verification executes repository code on your computer. Pass --allow-execution only for code you trust.'
    );
  const context = await loadRun(directory);
  const { run, state, contract } = context;
  const candidateBefore = await assertIntegrity(context);
  const dependencies = await dependencyReceipt(run);
  const upstreamAnalysis = await reaAttachment(run, state);
  // Sequential execution prevents the three checks from racing against one another.
  const source = await behavior(run, 'source', timeoutMs, contract.runtime);
  const baseline = await behavior(run, 'baseline', timeoutMs, contract.runtime);
  const candidate = await behavior(run, 'candidate', timeoutMs, contract.runtime);
  const regression = {};
  if (contract.regression) {
    for (const name of ['baseline', 'candidate']) {
      regression[name] = await runRegression(
        contract.regression,
        path.join(run, name),
        timeoutMs,
        contract.runtime
      );
    }
  }
  const checks = {};
  if (contract.checks)
    for (const side of ['baseline', 'candidate']) {
      checks[side] = [];
      for (const check of contract.checks) {
        const execution = await runProcess(check.command, check.args, {
          cwd: path.join(run, side),
          timeoutMs
        });
        delete execution.protocol;
        checks[side].push({
          name: check.name,
          status: execution.exitCode === 0 && !execution.reason ? 'passed' : 'failed',
          execution
        });
      }
    }
  let browser = null;
  if (contract.browser) {
    const artifacts = await fs.mkdtemp(path.join(run, 'browser-'));
    const baseline = await runBrowser(run, 'baseline', artifacts, timeoutMs);
    const candidate = await runBrowser(run, 'candidate', artifacts, timeoutMs);
    const gap =
      baseline.cases?.some((c) => c.status === 'mismatch') &&
      baseline.cases.every((c) => c.status !== 'error');
    const regressions =
      baseline.regression?.length === contract.browser.regression.length &&
      baseline.regression.every((c) => c.status === 'passed');
    browser = {
      status:
        baseline.status !== 'error' && gap && regressions && candidate.status === 'passed'
          ? 'passed'
          : 'failed',
      baselineDemonstratesGap: Boolean(gap),
      baseline,
      candidate
    };
  }
  let integrity = { status: 'passed' };
  try {
    await loadRun(run);
    if (!same(await reaAttachment(run, state), upstreamAnalysis))
      throw new Error('Rea evidence changed during verification.');
    if (!same(await dependencyReceipt(run), dependencies))
      throw Error('Dependency setup changed during verification.');
    const after = await assertIntegrity(context);
    if (!same(after, candidateBefore)) throw new Error('Candidate changed during verification.');
  } catch (error) {
    integrity = { status: 'failed', error: error.message };
  }
  const baselineDemonstratesGap =
    baseline.status === 'failed' &&
    baseline.cases?.some((c) => c.status === 'mismatch') &&
    baseline.cases.every((c) => c.status !== 'error');
  const behaviorPassed =
    source.status === 'passed' && candidate.status === 'passed' && baselineDemonstratesGap;
  const regressionsPassed =
    regression.baseline?.status === 'passed' && regression.candidate?.status === 'passed';
  const checksPassed =
    !contract.checks ||
    Object.values(checks)
      .flat()
      .every((check) => check.status === 'passed');
  const status =
    integrity.status !== 'passed' ||
    !checksPassed ||
    (browser && browser.status !== 'passed') ||
    !behaviorPassed ||
    (contract.regression && !regressionsPassed)
      ? 'failed'
      : regressionsPassed
        ? 'verified-for-contract'
        : 'behavior-verified-regressions-unchecked';
  const report = {
    version: verificationVersion(contract),
    verifiedAt: new Date().toISOString(),
    status,
    contractSha256: state.contractSha256,
    candidateSha256: hash(json(candidateBefore)),
    upstreamAnalysis,
    dependencies,
    source,
    baseline,
    candidate,
    baselineDemonstratesGap,
    regression,
    checks,
    integrity,
    browser,
    limitations: state.limitations
  };
  await saveJson(path.join(run, 'verification.json'), report);
  return report;
}

export async function exportPatchUnlocked(directory) {
  const context = await loadRun(directory);
  const { run, state, contract } = context;
  const candidate = await assertIntegrity(context);
  const verification = await readJson(await safePath(run, 'verification.json'));
  if (
    verification.version !== verificationVersion(contract) ||
    verification.status !== 'verified-for-contract' ||
    (contract.browser && verification.browser?.status !== 'passed') ||
    (contract.checks &&
      ['baseline', 'candidate'].some(
        (side) =>
          verification.checks?.[side]?.length !== contract.checks.length ||
          verification.checks[side].some(
            (check, i) => check.status !== 'passed' || check.name !== contract.checks[i].name
          )
      ))
  )
    throw new PortsmithError(
      'verification_required',
      'A current passing contract and regression verification are required before patch export.',
      'Run report to inspect failures, fix the candidate, and run verify with explicit execution authorization.'
    );
  if (
    verification.candidateSha256 !== hash(json(candidate)) ||
    verification.contractSha256 !== state.contractSha256
  )
    throw new PortsmithError(
      'verification_stale',
      'Verification is stale; verify the current candidate again.',
      'Re-run verify on the current candidate before exporting.'
    );
  if (!same(await reaAttachment(run, state), verification.upstreamAnalysis ?? null))
    throw new Error('Rea evidence changed; verify again before export.');
  if (!same(await dependencyReceipt(run), verification.dependencies ?? null))
    throw Error('Dependency setup changed; verify again before export.');
  if (contract.browser) await assertBrowserEvidence(run, verification.browser);
  // Diff only the exact inventories that were verified. Never diff the mutable
  // execution directory directly: excluded files may contain secrets or caches.
  const patchStage = await fs.mkdtemp(path.join(run, '.patch-'));
  let diff;
  try {
    for (const name of ['baseline', 'candidate']) await fs.mkdir(path.join(patchStage, name));
    await copyInventory(path.join(run, 'baseline'), path.join(patchStage, 'baseline'), state.targetSnapshot);
    await copyInventory(path.join(run, 'candidate'), path.join(patchStage, 'candidate'), candidate);
    diff = await runProcess(
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
      { cwd: patchStage, maxOutputBytes: 32_000_000 }
    );
  } finally {
    await fs.rm(patchStage, { recursive: true, force: true });
  }
  if (![0, 1].includes(diff.exitCode) || diff.reason)
    throw new Error(`Patch generation failed: ${diff.reason ?? diff.stderr}`);
  // Git's output uses baseline/candidate prefixes, including quoted paths with spaces.
  let inHunk = false;
  const patch = diff.stdout
    .split('\n')
    .map((line) => {
      if (line.startsWith('diff --git ')) {
        inHunk = false;
        return line.replace(/^(diff --git "?a\/)\w+\//, '$1').replace(/ ("?b\/)\w+\//, ' $1');
      }
      if (line.startsWith('@@') || line === 'GIT binary patch') inHunk = true;
      if (!inHunk && /^(--- |\+\+\+ )/.test(line))
        return line.replace(/^((?:--- |\+\+\+ )"?[ab]\/)\w+\//, '$1');
      return line;
    })
    .join('\n');
  const patchPath = path.join(run, 'transfer.patch');
  await safeWrite(patchPath, patch);
  // An unrelated ancestor Git repository can silently skip all relative patch paths.
  // Apply to a fresh repository rooted at a baseline copy, then compare every file.
  const replay = await fs.mkdtemp(path.join(run, '.patch-check-'));
  try {
    await copyInventory(path.join(run, 'baseline'), replay, state.targetSnapshot);
    for (const args of [
      ['-c', 'init.templateDir=', 'init', '--quiet'],
      ['apply', '--check', patchPath],
      ['apply', patchPath]
    ]) {
      const check = await runProcess('git', args, { cwd: replay });
      if (check.exitCode !== 0 || check.reason)
        throw new Error(`Patch does not apply cleanly: ${check.reason ?? check.stderr}`);
    }
    if (!same(await inventory(replay), candidate))
      throw new Error('Applied patch does not reproduce the verified candidate.');
  } finally {
    await fs.rm(replay, { recursive: true, force: true });
  }
  if (!same(await assertIntegrity(context), candidate))
    throw new Error('Candidate changed during patch export.');
  return {
    status: 'patch-ready',
    patch: patchPath,
    sha256: hash(patch),
    verifiedScope: 'Declared behavior, regression tests, browser cases and additional checks',
    destinationChanged: false
  };
}

export async function status(directory) {
  const context = await loadRun(directory);
  const files = await assertIntegrity(context);
  let verification = null;
  try {
    verification = await readJson(await safePath(context.run, 'verification.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let browserEvidenceStale = false;
  if (context.contract.browser && verification) {
    try {
      await assertBrowserEvidence(context.run, verification.browser);
    } catch {
      browserEvidenceStale = true;
    }
  }
  let dependenciesStale = false;
  if (verification) {
    try {
      dependenciesStale = !same(await dependencyReceipt(context.run), verification.dependencies ?? null);
    } catch {
      dependenciesStale = true;
    }
  }
  return {
    run: context.run,
    candidate: path.join(context.run, 'candidate'),
    candidateFiles: files,
    verification: verification
      ? {
          status: verification.status,
          stale:
            browserEvidenceStale ||
            verification.version !== verificationVersion(context.contract) ||
            dependenciesStale ||
            verification.candidateSha256 !== hash(json(files)) ||
            !same(verification.upstreamAnalysis ?? null, await reaAttachment(context.run, context.state))
        }
      : null,
    analysis: context.state.analysis,
    upstreamAnalysis: await reaAttachment(context.run, context.state)
  };
}

export const adapt = (directory, proposalFile) =>
  withRunLock(directory, () => adaptUnlocked(directory, proposalFile));
export const verify = (directory, options) =>
  withRunLock(directory, () => verifyUnlocked(directory, options));
export const exportPatch = (directory) => withRunLock(directory, () => exportPatchUnlocked(directory));
