import { parseArgs, parseEnv } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { commands } from '../../contracts/commands.mjs';
import { commandResult, version } from '../../application/service.mjs';
import { diagnostic, PortsmithError } from '../../domain/errors.mjs';
import { safeWrite } from '../../platform/files.mjs';

const aliases = {
  dependencySource: 'dependency-source',
  managerBin: 'manager-bin',
  virtualModules: 'virtual-modules',
  baseURL: 'base-url',
  allowExecution: 'allow-execution',
  allowModel: 'allow-model',
  maxAttempts: 'max-attempts',
  timeoutMs: 'timeout-ms'
};
const booleanFlags = new Set([
  'allowExecution',
  'allowModel',
  'browser',
  'aliases',
  'offline',
  'virtualModules',
  'capture'
]);
const flagName = (key) => aliases[key] ?? key;
const help = (command) => {
  if (command && commands[command]) {
    const def = commands[command];
    return (
      `portsmith ${command}\n${def.description}\n\nOptions:\n` +
      Object.entries(def.input.shape)
        .map(
          ([key, schema]) =>
            `  --${flagName(key)}${booleanFlags.has(key) ? '' : ' VALUE'}${schema.isOptional() ? ' (optional)' : ' (required)'}`
        )
        .join('\n') +
      '\n\nOutput: --json, --human, --output FILE\nEnvironment: --env FILE (explicit local .env; never loaded automatically)\n'
    );
  }
  return (
    `Portsmith ${version} — transfer a feature with reviewable evidence.\n\n` +
    Object.entries(commands)
      .map(([name, def]) => `  ${name.padEnd(14)} ${def.description}`)
      .join('\n') +
    '\n\nStart: portsmith-demo (included authored example)\nHelp: portsmith COMMAND --help\nEnvironment: --env FILE\nJSON: --json (also the default when stdout is piped)\nSchemas: portsmith schema --command contract\n'
  );
};

function human(name, result) {
  if (name === 'capabilities')
    return (
      `Portsmith ${result.version}\n` +
      result.operations
        .map((c) => `${c.available ? 'available' : 'disabled '}  ${c.name.padEnd(12)} ${c.description}`)
        .join('\n')
    );
  if (name === 'doctor')
    return (
      `${result.status}\n${result.destination ? `Destination requires Node ${result.destination.nodeEngine ?? 'unspecified'}; package manager ${result.destination.packageManager ?? 'see lockfile'}. Compatibility is not validated.\n` : ''}` +
      result.checks
        .map(
          (c) =>
            `${c.status.padEnd(6)}  ${c.id}: ${c.value}${c.remediation ? `\n        ${c.remediation}` : ''}`
        )
        .join('\n')
    );
  if (name === 'dependencies')
    return (
      `${result.status}\n` +
      result.sides
        .map(
          (x) =>
            `${x.side}: ${x.status} — ${x.manager ?? x.reason ?? ''}${x.workspace?.enabled ? ` (${x.workspace.members.length} workspace packages)` : ''} ${(x.blockers ?? []).join(' ')}`
        )
        .join('\n') +
      '\nNext: install-deps --run DIR --allow-execution'
    );
  if (name === 'capture-aliases')
    return `Captured ${result.local} local resolutions from ${result.records} import pairs (${result.unsupported} unresolved/unsupported).\nGenerated modules: ${result.virtualModules}. Planned package imports: ${result.plannedImports}.\nCopy: ${result.source}\n${result.next}`;
  if (name === 'setup-deps')
    return `${result.status}: ${result.source}\n${result.additions.length} added declarations, ${result.imports} import pairs.\n${result.next}`;
  if (name === 'discover-imports')
    return `${result.status}: ${result.records.length} imports, ${result.additions.length} additions\n${result.blockers.join('\n')}`;
  if (name === 'install-deps') return `${result.status}\n${result.next}`;
  if (name === 'init') return `Created ${result.workspace}\n${result.next}`;
  if (name === 'discover')
    return (
      `${result.totalMatches} matches · ${result.coverage.scanned} files scanned · ${result.coverage.status}\n` +
      result.candidates
        .map((c) => `  ${c.entry} — ${c.exports.map((e) => e.name).join(', ') || 'no static exports'}`)
        .join('\n') +
      `\n${result.coverage.resultsTruncated ? 'More results available; increase --limit (max 100).\n' : ''}Next: inspect a selected entry. Lexical matches are not runtime proof.`
    );
  if (name === 'inspect')
    return (
      `${result.files.length} feature files · ${result.externals.length} external dependencies\n` +
      (!result.target ? 'No destination: dependency compatibility not compared.\n' : '') +
      result.files.map((file) => `  ${file.path}`).join('\n') +
      '\n' +
      (result.exports?.length
        ? 'Export syntax (not runtime proof):\n' +
          result.exports
            .filter((e) => e.path === result.entry)
            .map((e) => `  ${e.name} — ${e.typeOnly ? 'type only' : e.callable} (${e.path}:${e.line})`)
            .join('\n') +
          '\n'
        : '') +
      (result.blockers.length
        ? `Blocked:\n${result.blockers.map((x) => `  • ${x}`).join('\n')}`
        : 'No static blockers found. Next: plan the transfer and define its behavior contract.')
    );
  if (name === 'plan')
    return (
      `${result.status}\n${result.files.map((f) => `  ${f.source} → ${f.destination}`).join('\n')}\n${result.generatedFiles.map((f) => `  module scope → ${f.destination}`).join('\n')}\n\n` +
      [
        ...result.blockers.map((b) => `Blocked: ${b}`),
        ...result.steps.map((s, i) => `${i + 1}. ${s.action}`)
      ].join('\n')
    );
  if (name === 'status')
    return `${result.verification?.stale ? 'stale' : (result.verification?.status ?? 'not-verified')}\nCandidate: ${result.candidate}\nFiles: ${Object.keys(result.candidateFiles).length}\nNext: portsmith report --run ${JSON.stringify(result.run)}`;
  if (name === 'report')
    return (
      `${result.status}\n` +
      (result.behavior
        ? Object.entries(result.behavior)
            .map(([side, r]) => `${side.padEnd(10)} ${r.passed}/${r.total} passed (${r.status})`)
            .join('\n')
        : 'No behavior verification recorded.') +
      (result.browser ? `\nBrowser: ${result.browser.status}` : '') +
      (result.checks
        ? Object.entries(result.checks)
            .flatMap(([side, checks]) =>
              checks.map((check) => `\n${side} check: ${check.name} — ${check.status}`)
            )
            .join('')
        : '') +
      `\n\nNext: ${result.next}`
    );
  if (name === 'auto-adapt')
    return `${result.status}\nAttempts: ${result.attempts.length}\nEvidence: ${result.evidence}${result.reason ? `\n${result.reason}` : ''}${result.blockers?.map((item) => `\nBlocked: ${item.stage} — ${item.message}`).join('') ?? ''}${result.patch ? `\nPatch: ${result.patch.patch}` : ''}`;
  if (name === 'verify')
    return `${result.status}\nSource: ${result.source.status}\nBaseline: ${result.baseline.status}\nCandidate: ${result.candidate.status}\nReport: ${result.report}`;
  if (name === 'prepare')
    return `Prepared ${result.copiedFiles} files\nCandidate: ${result.candidate}\nNext: ${result.next}`;
  if (name === 'export')
    return `Patch ready: ${result.patch}\nSHA-256: ${result.sha256}\nOriginal destination unchanged.`;
  return JSON.stringify(result, null, 2);
}

export async function main(args = process.argv.slice(2)) {
  let asJson = !process.stdout.isTTY;
  try {
    const options = {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
      json: { type: 'boolean' },
      human: { type: 'boolean' },
      output: { type: 'string' },
      env: { type: 'string' }
    };
    for (const definition of Object.values(commands))
      for (const key of Object.keys(definition.input.shape))
        options[flagName(key)] = {
          type: booleanFlags.has(key) ? 'boolean' : 'string'
        };
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options });
    if (values.json && values.human)
      throw new PortsmithError(
        'invalid_input',
        'Choose --json or --human, not both.',
        'Remove one output-format flag.'
      );
    asJson = values.json || (!values.human && !process.stdout.isTTY);
    const name = positionals[0];
    if (values.version) {
      console.log(version);
      return;
    }
    if (!name || values.help) {
      console.log(help(name));
      return;
    }
    if (positionals.length !== 1 || !commands[name])
      throw new PortsmithError(
        'unknown_command',
        `Unknown command: ${positionals.join(' ')}`,
        'Run portsmith --help.'
      );
    const input = {};
    const allowed = new Map(Object.keys(commands[name].input.shape).map((key) => [flagName(key), key]));
    for (const [flag, value] of Object.entries(values)) {
      if (['json', 'human', 'help', 'version', 'output', 'env'].includes(flag)) continue;
      if (!allowed.has(flag))
        throw new PortsmithError(
          'invalid_option',
          `--${flag} is not accepted by ${name}.`,
          `Run portsmith ${name} --help.`
        );
      const key = allowed.get(flag);
      input[key] = ['timeoutMs', 'maxAttempts', 'limit'].includes(key) ? Number(value) : value;
    }
    if (values['env']) {
      const environment = parseEnv(await fs.readFile(path.resolve(values['env']), 'utf8'));
      for (const [key, value] of Object.entries(environment)) process.env[key] ??= value;
    }
    const reply = await commandResult(name, input, { allowExecution: values['allow-execution'] === true });
    if (!reply.ok) {
      console.error(
        asJson
          ? JSON.stringify({ error: reply.error }, null, 2)
          : `${reply.error.code}: ${reply.error.message}\nNext: ${reply.error.remediation}`
      );
      process.exitCode = 1;
      return;
    }
    let result = reply.result;
    if (name === 'verify') {
      result = { ...result, report: path.resolve(input.run, 'verification.json') };
      if (result.status !== 'verified-for-contract') process.exitCode = 1;
    }
    if (name === 'auto-adapt' && result.status !== 'verified-for-contract') process.exitCode = 1;
    if (
      (name === 'inspect' && result.blockers.length) ||
      (name === 'plan' && result.status === 'blocked') ||
      (name === 'doctor' && result.status !== 'ready') ||
      (name === 'dependencies' && result.status === 'blocked')
    )
      process.exitCode = 1;
    const serialized = JSON.stringify(result, null, 2) + '\n';
    if (values.output) await safeWrite(path.resolve(values.output), serialized);
    console.log(asJson ? serialized.trimEnd() : human(name, result));
  } catch (error) {
    const d = diagnostic(error);
    console.error(
      asJson ? JSON.stringify({ error: d }, null, 2) : `${d.code}: ${d.message}\nNext: ${d.remediation}`
    );
    process.exitCode = 1;
  }
}
