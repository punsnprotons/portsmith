import fs from 'node:fs/promises';
import path from 'node:path';
import { commands, jsonSchema, proposalSchema } from '../contracts/commands.mjs';
import { contractSchema, validateContract } from '../contracts/behavior.mjs';
import { PortsmithError, diagnostic } from '../domain/errors.mjs';
import { analyze } from '../providers/javascript/analyze.mjs';
import { traceWithRea } from '../providers/rea/client.mjs';
import { prepare, adapt, verify, exportPatch, status, loadRun, assertIntegrity } from './transfer.mjs';
import { inside, rootDir, readJson, safePath } from '../platform/files.mjs';
import { planTransfer } from './planning.mjs';
import { autoAdapt } from './autonomous.mjs';
import { modelConfigSchema } from '../providers/model/client.mjs';
import { discover } from '../providers/javascript/discover.mjs';
import { init } from './setup.mjs';
import { dependencyPlan, installDependencies } from './dependencies.mjs';
import { captureAliases } from './capture-aliases.mjs';
import { discoverImports } from './package-imports.mjs';
import { setupDependencies } from './setup-dependencies.mjs';
import { doctor } from './doctor.mjs';

import { version } from '../domain/version.mjs';
export { version };

export function capabilities({ allowExecution = false } = {}) {
  return {
    version,
    operations: Object.entries(commands).map(([name, item]) => ({
      name,
      tool: item.tool,
      description: item.description,
      effects: item.effects,
      requiresExecution: item.execution,
      available: !item.execution || allowExecution,
      schemaCommand: `portsmith schema --command ${name}`
    })),
    providers: [
      { id: 'javascript-static', role: 'literal JS/TS import closure', available: true },
      {
        id: 'node-contract',
        role: 'JSON callable behavior, node:test and Vitest 0.34/4.1 regressions, opt-in relative imports and local aliases, declared build/type checks',
        available: allowExecution
      },
      {
        id: 'browser',
        role: 'Chromium interaction assertions, screenshots and traces',
        available: allowExecution
      },
      {
        id: 'model',
        role: 'bounded OpenAI-compatible proposal and repair loop',
        available: 'requires-config-and-authorization'
      },
      {
        id: 'rea',
        role: 'optional upstream application analysis and feature trace',
        available: 'requires-explicit-provider-config'
      }
    ],
    limitations: [
      'Autonomous edits require a configured model; browser checks support Chromium and local apps. Locked npm/pnpm setup is explicit; cross-framework conversion is unsupported.',
      'Host execution is not a security sandbox.'
    ]
  };
}

export function schemaFor(name) {
  const schema =
    name === 'model'
      ? modelConfigSchema
      : name === 'contract'
        ? contractSchema
        : name === 'proposal'
          ? proposalSchema
          : commands[name]?.input;
  if (!schema)
    throw new PortsmithError(
      'unknown_schema',
      `Unknown schema: ${name}`,
      'Run portsmith capabilities to discover command names; contract and proposal are also supported.'
    );
  return { name, schema: jsonSchema(schema) };
}

async function scopedInput(input, definition, root) {
  if (!root) return input;
  const allowed = await rootDir(root);
  const scoped = { ...input };
  async function admit(value, missing = false) {
    const absolute = path.resolve(value);
    const resolved = missing
      ? path.join(await fs.realpath(path.dirname(absolute)), path.basename(absolute))
      : await fs.realpath(absolute);
    if (!inside(allowed, resolved))
      throw new PortsmithError(
        'outside_workspace',
        `Path must be inside the configured MCP root: ${allowed}`,
        'Select source, target, contract and run paths within the configured workspace.'
      );
    return resolved;
  }
  for (const [key, kind] of Object.entries(definition.paths)) {
    if (scoped[key] === undefined) continue;
    scoped[key] = await admit(scoped[key], kind === 'new');
    if (kind === 'run') {
      const { state } = await loadRun(scoped[key]);
      await admit(state.analysis.source);
      await admit(state.analysis.target);
    }
  }
  if (definition.tool === 'diagnose_environment' && !scoped.workspace) scoped.workspace = allowed;
  return scoped;
}

export async function transferReport(run) {
  const current = await status(run);
  let evidence = null;
  try {
    evidence = await readJson(await safePath(current.run, 'verification.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return {
    run: current.run,
    status: current.verification?.stale ? 'stale' : (current.verification?.status ?? 'not-verified'),
    feature: current.analysis.entry,
    destination: current.analysis.target,
    behavior: evidence
      ? Object.fromEntries(
          ['source', 'baseline', 'candidate'].map((side) => [
            side,
            {
              status: evidence[side].status,
              passed: evidence[side].cases?.filter((c) => c.status === 'passed').length ?? 0,
              total: evidence[side].cases?.length ?? 0,
              errors: evidence[side].error ?? null
            }
          ])
        )
      : null,
    regressions: evidence?.regression ?? null,
    checks: evidence?.checks ?? null,
    browser: evidence?.browser ?? null,
    integrity: evidence?.integrity ?? null,
    upstreamAnalysis: current.upstreamAnalysis
      ? {
          server: current.upstreamAnalysis.server,
          coverage: current.upstreamAnalysis.coverage,
          evidenceId: current.upstreamAnalysis.traceEvidenceId
        }
      : null,
    next:
      !evidence || current.verification.stale
        ? 'Run verify after reviewing the candidate.'
        : evidence.status === 'verified-for-contract'
          ? 'Export and review the patch.'
          : 'Inspect verification.json and fix the candidate; do not weaken the contract.',
    limitations: evidence?.limitations ?? current.analysis.limitations
  };
}

export async function executeCommand(name, raw = {}, policy = {}) {
  const definition = commands[name];
  if (!definition)
    throw new PortsmithError(
      'unknown_command',
      `Unknown command: ${name}`,
      'Run portsmith --help or portsmith capabilities.'
    );
  const parsed = definition.input.parse(raw);
  if (definition.execution && (!policy.allowExecution || parsed.allowExecution !== true)) {
    throw new PortsmithError(
      'execution_not_authorized',
      'Repository/provider execution requires explicit authorization.',
      'CLI: pass --allow-execution. MCP: enable execution at server startup and authorize the individual call.'
    );
  }
  const input = await scopedInput(parsed, definition, policy.root);
  switch (name) {
    case 'discover-imports':
      return discoverImports(input);
    case 'setup-deps':
      return setupDependencies(input);
    case 'capture-aliases':
      return captureAliases(input);
    case 'auto-adapt':
      return autoAdapt(input.run, input);
    case 'discover':
      return discover(input);
    case 'init':
      return init(input);
    case 'inspect':
      return analyze(input);
    case 'plan':
      return planTransfer(input);
    case 'prepare':
      return prepare(input);
    case 'adapt':
      return adapt(input.run, input.proposal);
    case 'verify':
      return verify(input.run, input);
    case 'export':
      return exportPatch(input.run);
    case 'status':
      return status(input.run);
    case 'report':
      return transferReport(input.run);
    case 'dependencies':
      return dependencyPlan(input);
    case 'install-deps':
      return installDependencies(input);
    case 'doctor':
      return doctor(input);
    case 'capabilities':
      return capabilities(policy);
    case 'schema':
      return schemaFor(input.command);
    case 'validate': {
      const contract = validateContract(await readJson(input.contract));
      return {
        status: 'valid',
        cases: contract.cases.length,
        regressionConfigured: Boolean(contract.regression),
        limitations: ['Schema validity does not prove behavior or regression-runner support.']
      };
    }
    case 'rea-trace': {
      const context = await loadRun(input.run);
      return traceWithRea({
        ...context,
        configFile: input.config,
        allowExecution: true,
        checkIntegrity: () => assertIntegrity(context)
      });
    }
  }
}

export async function commandResult(name, input, policy) {
  try {
    return { ok: true, operation: name, result: await executeCommand(name, input, policy) };
  } catch (error) {
    return { ok: false, operation: name, error: diagnostic(error) };
  }
}
