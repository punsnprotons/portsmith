import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadRun,
  assertIntegrity,
  assertCandidateDependencies,
  adaptUnlocked,
  verifyUnlocked,
  exportPatchUnlocked,
  protectedFile
} from './transfer.mjs';
import { loadAliases } from '../providers/javascript/aliases.mjs';
import { analyze } from '../providers/javascript/analyze.mjs';
import { modelConfig, propose } from '../providers/model/client.mjs';
import { hash, json, readJson, safePath, saveJson, withRunLock } from '../platform/files.mjs';
import { regressionFiles } from '../providers/node/regression.mjs';
import { PortsmithError, diagnostic } from '../domain/errors.mjs';

const immutable = (rel, context) =>
  protectedFile(rel) ||
  context.frozenAliasFiles?.includes(rel) ||
  regressionFiles(context.contract.regression)?.includes(rel) ||
  rel === context.state.analysis.mount ||
  rel.startsWith(context.state.analysis.mount + '/') ||
  /(^|\/)(package(?:-lock)?\.json|[^/]*lock[^/]*|LICENSE[^/]*|NOTICE[^/]*|PORTSMITH_PROVENANCE\.json)$/.test(
    rel
  );
export async function assertAutonomousProposal(context, proposal) {
  const directives = (text) =>
    [...text.matchAll(/^[ \t]*(?:\/\/|\/\*|\*)[ \t]*@ts-(?:ignore|nocheck|expect-error)\b/gm)].length;
  for (const edit of proposal.edits) {
    if (immutable(edit.path, context))
      throw new PortsmithError(
        'protected_edit',
        `Model attempted to edit protected file: ${edit.path}`,
        'Adapt destination implementation only; keep new wrappers and declarations outside the copied feature directory.'
      );
    let before = '';
    try {
      before = await fs.readFile(await safePath(path.join(context.run, 'candidate'), edit.path), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (directives(edit.content) > directives(before))
      throw new PortsmithError(
        'type_check_suppression',
        `Model attempted to suppress TypeScript checks in ${edit.path}`,
        'Fix the types or add a destination runtime wrapper with a matching declaration outside the copied feature. Do not add @ts-ignore, @ts-nocheck or @ts-expect-error.'
      );
  }
}
function feedback(report) {
  const compact = (result) => ({
    ...result,
    ...(result.counts?.files
      ? { counts: { ...result.counts, files: undefined, fileCount: result.counts.files.length } }
      : {}),
    execution:
      result.status === 'passed'
        ? undefined
        : result.execution && {
            exitCode: result.execution.exitCode,
            reason: result.execution.reason,
            stdoutTail: result.execution.stdout?.slice(-8000),
            stderrTail: result.execution.stderr?.slice(-8000)
          }
  });
  return {
    status: report.status,
    source: report.source,
    baseline: report.baseline,
    candidate: report.candidate,
    regression:
      report.regression &&
      Object.fromEntries(Object.entries(report.regression).map(([side, result]) => [side, compact(result)])),
    checks:
      report.checks &&
      Object.fromEntries(
        Object.entries(report.checks).map(([side, results]) => [side, results.map(compact)])
      ),
    diagnosticOutput:
      'Failure output tails are bounded to 8000 characters per stream; full execution evidence is retained in the run.',
    browser: report.browser
  };
}
export async function modelContext(context, report, lastError, config) {
  const files = await assertIntegrity(context),
    contents = [];
  const aliases = context.contract.runtime?.aliases
    ? await loadAliases(path.join(context.run, 'candidate'))
    : null;
  const selected =
    config.contextFiles &&
    new Set([
      ...config.contextFiles,
      // Captures can bind hundreds of data/config files. Their identities are
      // already in aliases.files; include source text only when explicitly requested.
      ...(aliases?.captured ? [] : (aliases?.files.map((file) => file.path) ?? [])),
      context.contract.target.module,
      ...Object.keys(files).filter((rel) => rel.startsWith(context.state.analysis.mount + '/')),
      ...(regressionFiles(context.contract.regression) ?? []),
      ...('package.json' in files ? ['package.json'] : [])
    ]);
  if (selected)
    for (const rel of selected) {
      await safePath(path.join(context.run, 'candidate'), rel);
      if (!files[rel]) throw new Error(`Context file is not in the candidate inventory: ${rel}`);
    }
  for (const [rel, identity] of Object.entries(files)) {
    if (selected ? !selected.has(rel) : !/\.(?:[cm]?[jt]sx?|vue|svelte|html|css|json)$/.test(rel)) continue;
    const bytes = await fs.readFile(await safePath(path.join(context.run, 'candidate'), rel));
    if (bytes.includes(0)) continue;
    contents.push({
      path: rel,
      sha256: identity.sha256,
      editable: !immutable(rel, context),
      content: bytes.toString('utf8')
    });
  }
  const result = {
    contract: context.contract,
    aliases,
    featureMount: context.state.analysis.mount,
    integrationConstraints: {
      immutableFeatureDirectory: context.state.analysis.mount,
      newFilesInsideFeatureDirectory: false,
      missingTypes:
        'Create destination-side runtime wrappers and matching declarations outside the immutable feature directory. Do not suppress type errors or alter compiler settings.'
    },
    files: contents,
    contextSelection: {
      mode: selected ? 'explicit' : 'all-supported-text',
      included: contents.map((file) => file.path),
      omitted: Object.keys(files).filter((rel) => !contents.some((file) => file.path === rel))
    },
    verification: feedback(report),
    previousProposalError: lastError
  };
  if (Buffer.byteLength(JSON.stringify(result)) > config.maxContextBytes)
    throw new PortsmithError(
      'model_context_limit',
      'Transfer exceeds the configured model context limit.',
      'Set contextFiles to explicit relevant candidate paths or increase maxContextBytes (maximum 1 MB). Selection is recorded; nothing is silently truncated.'
    );
  return result;
}
async function featureConnected(context) {
  const graph = await analyze({
    source: path.join(context.run, 'candidate'),
    target: path.join(context.run, 'baseline'),
    entry: context.contract.target.module,
    runtimeOnly: true,
    aliases: context.contract.runtime?.aliases ?? false
  });
  return (
    graph.blockers.length === 0 &&
    graph.files.some(
      (file) => file.path === `${context.state.analysis.mount}/${context.state.analysis.entry}`
    )
  );
}
export async function autoAdapt(
  directory,
  { config: configFile, allowExecution = false, allowModel = false, maxAttempts = 3, timeoutMs = 30000 } = {}
) {
  if (!allowExecution || !allowModel)
    throw new PortsmithError(
      'autonomy_not_authorized',
      'Autonomous adaptation requires model transmission and code-execution authorization.',
      'Pass --allow-model and --allow-execution after reviewing the model endpoint and repository.'
    );
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5)
    throw new Error('maxAttempts must be 1–5.');
  return withRunLock(directory, async () => {
    const context = await loadRun(directory),
      config = modelConfig(await readJson(configFile));
    if (!process.env[config.apiKeyEnv])
      throw new PortsmithError(
        'model_key_missing',
        `Missing environment variable ${config.apiKeyEnv}.`,
        'Start with node --env-file=.env src/cli.mjs auto-adapt ...'
      );
    if (!context.contract.regression)
      throw new PortsmithError(
        'regression_required',
        'Autonomous adaptation requires a frozen regression command.',
        'Prepare a new run with existing destination regression tests.'
      );
    const evidence = await fs.mkdtemp(path.join(context.run, 'autonomy-'));
    const summary = {
      status: 'running',
      model: config.model,
      endpoint: config.baseURL,
      attempts: [],
      evidence,
      limits: {
        maxAttempts,
        maxOutputTokens: config.maxOutputTokens,
        maxContextBytes: config.maxContextBytes
      },
      patch: null
    };
    const persist = () => saveJson(path.join(evidence, 'summary.json'), summary);
    await persist();
    try {
      await assertCandidateDependencies(context.run);
    } catch (error) {
      summary.status = 'preflight-failed';
      summary.reason = 'Candidate dependency setup is unsupported. No model request was sent.';
      summary.blockers = [
        {
          stage: 'candidate-dependencies',
          message: diagnostic(error).message + ' ' + diagnostic(error).remediation
        }
      ];
      await persist();
      return summary;
    }
    // Validate user-selected context before expensive builds, tests or provider calls.
    // A missing path is setup failure, not three failed integration proposals.
    try {
      await modelContext(context, {}, null, config);
    } catch (error) {
      summary.status = 'preflight-failed';
      summary.reason = 'Model context setup failed. No repository code ran and no model request was sent.';
      summary.blockers = [
        {
          stage: 'model-context',
          code: diagnostic(error).code,
          message: diagnostic(error).message + ' ' + diagnostic(error).remediation
        }
      ];
      await persist();
      return summary;
    }
    let report = await verifyUnlocked(context.run, { allowExecution: true, timeoutMs }),
      lastError = null;
    await saveJson(path.join(evidence, 'initial-verification.json'), report);
    const blockers = [];
    const block = (stage, message) => blockers.push({ stage, message });
    if (report.source.status !== 'passed')
      block('source-behavior', 'Source contract cases did not all pass.');
    if (!report.baselineDemonstratesGap)
      block('baseline-behavior', 'Baseline must demonstrate a value mismatch without execution errors.');
    if (report.regression.baseline?.status !== 'passed')
      block(
        'baseline-regressions',
        report.regression.baseline?.error ??
          'Existing tests did not complete successfully. See initial-verification.json.'
      );
    for (const check of report.checks?.baseline ?? [])
      if (check.status !== 'passed')
        block(
          'baseline-check',
          `${check.name}: ${check.execution.reason ?? `exit ${check.execution.exitCode}`}`
        );
    if (report.integrity.status !== 'passed')
      block('integrity', report.integrity.error ?? 'Snapshot integrity failed.');
    if (report.browser) {
      if (report.browser.baseline.status === 'error')
        block('baseline-browser', report.browser.baseline.error ?? 'Browser did not complete.');
      for (const scenario of report.browser.baseline.cases ?? [])
        if (scenario.status === 'error') block('baseline-browser', `${scenario.name}: ${scenario.error}`);
      for (const scenario of report.browser.baseline.regression ?? [])
        if (scenario.status !== 'passed')
          block('baseline-browser-regressions', `${scenario.name}: ${scenario.status}`);
      if (!report.browser.baselineDemonstratesGap)
        block(
          'baseline-browser-gap',
          'Browser cases must demonstrate a baseline mismatch without execution errors.'
        );
    }
    if (blockers.length) {
      summary.status = 'preflight-failed';
      summary.reason = 'Frozen inputs or their execution environment failed. No model request was sent.';
      summary.blockers = blockers;
      await persist();
      return summary;
    }
    let connected = await featureConnected(context);
    if (!connected)
      lastError = {
        code: 'feature_not_connected',
        message:
          'Import and call the copied feature from the destination callable entry. Do not reimplement it.'
      };
    for (
      let attempt = 1;
      (report.status !== 'verified-for-contract' || !connected) && attempt <= maxAttempts;
      attempt++
    ) {
      const record = { attempt, status: 'requesting' };
      summary.attempts.push(record);
      await persist();
      try {
        const input = await modelContext(context, report, lastError, config);
        record.contextSha256 = hash(json(input));
        record.contextSelection = input.contextSelection;
        const generated = await propose(config, input);
        record.usage = generated.usage;
        record.model = generated.model;
        const proposalFile = path.join(evidence, `attempt-${attempt}-proposal.json`);
        await saveJson(proposalFile, generated.proposal);
        record.proposal = proposalFile;
        await assertAutonomousProposal(context, generated.proposal);
        await adaptUnlocked(context.run, proposalFile);
        connected = await featureConnected(context);
        if (!connected)
          throw new PortsmithError(
            'feature_not_connected',
            'Destination entry does not import the copied feature through its literal dependency graph.',
            'Import and call the transferred implementation instead of reimplementing it.'
          );
        report = await verifyUnlocked(context.run, { allowExecution: true, timeoutMs });
        await saveJson(path.join(evidence, `attempt-${attempt}-verification.json`), report);
        record.status = report.status;
        lastError = null;
        if (report.integrity.status !== 'passed') {
          summary.status = 'integrity-failed';
          break;
        }
      } catch (error) {
        record.status = 'rejected';
        record.error = diagnostic(error);
        lastError = { code: record.error.code, message: record.error.message };
        if (
          [
            'model_key_missing',
            'model_request_failed',
            'model_context_limit',
            'snapshot_changed',
            'contract_changed'
          ].includes(error.code)
        ) {
          summary.status = 'blocked';
          break;
        }
      }
      await persist();
    }
    if (report.status === 'verified-for-contract' && connected) {
      summary.patch = await exportPatchUnlocked(context.run);
      summary.status = 'verified-for-contract';
    } else if (summary.status === 'running') summary.status = 'attempts-exhausted';
    await persist();
    return summary;
  });
}
