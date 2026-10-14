import { z } from 'zod';

const text = z.string().min(1);
const feature = {
  source: text,
  target: text,
  entry: text,
  mount: text.optional(),
  aliases: z.boolean().optional()
};
const run = { run: text };
const command = (tool, description, input, paths = {}, effects = 'read', execution = false) => ({
  tool,
  description,
  input: z.object(input).strict(),
  paths,
  effects,
  execution
});

// One public command contract drives CLI parsing, MCP registration, JSON Schema,
// authorization and capability discovery. Providers don't depend on adapters.
export const commands = Object.freeze(
  Object.assign(Object.create(null), {
    'discover-imports': command(
      'discover_package_imports',
      'Discover literal package imports and missing declarations from repository code or proposed JS/TS edits without applying them.',
      { source: text, proposal: text.optional(), dependencySource: text.optional() },
      { source: 'existing', proposal: 'existing', dependencySource: 'existing' }
    ),
    'setup-deps': command(
      'setup_repository_dependencies',
      'Discover imports, add reviewed donor declarations, resolve and install locked dependencies in a fresh copy before prepare; optionally capture Vite imports.',
      {
        source: text,
        out: text,
        proposal: text.optional(),
        dependencySource: text.optional(),
        cache: text.optional(),
        capture: z.boolean().default(false),
        virtualModules: z.boolean().default(false),
        managerBin: text.optional(),
        offline: z.boolean().default(false),
        allowExecution: z.boolean().default(false),
        timeoutMs: z.number().int().min(1).max(120000).default(120000)
      },
      {
        source: 'existing',
        out: 'new',
        proposal: 'existing',
        dependencySource: 'existing',
        cache: 'existing'
      },
      'execute',
      true
    ),
    'capture-aliases': command(
      'capture_framework_aliases',
      'Capture Vite/plugin resolutions, optional virtual ESM and planned package imports in a fresh dependency-equipped copy.',
      {
        source: text,
        out: text,
        imports: text.optional(),
        virtualModules: z.boolean().default(false),
        mode: z
          .string()
          .regex(/^[a-zA-Z0-9_-]{1,40}$/)
          .default('production'),
        allowExecution: z.boolean().default(false),
        timeoutMs: z.number().int().min(1).max(120000).default(120000)
      },
      { source: 'existing', out: 'new', imports: 'existing' },
      'execute',
      true
    ),
    'auto-adapt': command(
      'auto_adapt_transfer',
      'Generate integration proposals using a configured model, verify and repair within bounded attempts, then export only on success.',
      {
        ...run,
        config: text,
        allowExecution: z.boolean().default(false),
        allowModel: z.boolean().default(false),
        maxAttempts: z.number().int().min(1).max(5).default(3),
        timeoutMs: z.number().int().min(1).max(120000).default(30000)
      },
      { run: 'run', config: 'existing' },
      'execute',
      true
    ),
    discover: command(
      'discover_features',
      'Find ranked JS/TS entry points by export name, path and source terms without executing repository code.',
      { source: text, query: text.optional(), limit: z.number().int().min(1).max(100).default(20) },
      { source: 'existing' }
    ),
    init: command(
      'initialize_workspace',
      'Create a new private setup directory with model configuration and an environment template. Never overwrites an existing directory.',
      { out: text, model: text, baseURL: text.optional() },
      { out: 'new' },
      'write'
    ),
    inspect: command(
      'inspect_feature',
      'Inspect literal JS/TS imports and export syntax without executing code. An optional destination enables dependency comparison.',
      { ...feature, target: text.optional() },
      { source: 'existing', target: 'existing' }
    ),
    plan: command(
      'plan_transfer',
      'Inspect destination conventions and produce a file mapping, blockers and integration checklist before preparing a transfer.',
      feature,
      { source: 'existing', target: 'existing' }
    ),
    prepare: command(
      'prepare_transfer',
      'Create source, baseline and candidate copies with a frozen behavior contract. Does not execute repository code.',
      { ...feature, contract: text, out: text },
      { source: 'existing', target: 'existing', contract: 'existing', out: 'new' },
      'write'
    ),
    adapt: command(
      'adapt_transfer',
      'Apply a hash-checked integration proposal to a candidate copy. Keeps original repositories unchanged.',
      { ...run, proposal: text },
      { run: 'run', proposal: 'existing' },
      'write'
    ),
    verify: command(
      'verify_transfer',
      'Execute trusted repository behavior and Node regression tests; retain scoped evidence. Requires explicit execution authorization.',
      {
        ...run,
        allowExecution: z.boolean().default(false),
        timeoutMs: z.number().int().min(1).max(120000).default(10000)
      },
      { run: 'run' },
      'execute',
      true
    ),
    export: command(
      'export_transfer',
      'Export a patch only after current behavior and regression checks pass. Checks applyability without editing the original app.',
      run,
      { run: 'run' },
      'write'
    ),
    status: command(
      'inspect_transfer',
      'Inspect candidate hashes, analysis, integrity and verification freshness without executing repository code.',
      run,
      { run: 'run' }
    ),
    report: command(
      'transfer_report',
      'Read a concise report of checked behavior, regressions, upstream analysis and remaining blockers.',
      run,
      { run: 'run' }
    ),
    'rea-trace': command(
      'trace_with_rea',
      'Start an explicitly configured Rea MCP provider and retain its application analysis and module trace.',
      { ...run, config: text, allowExecution: z.boolean().default(false) },
      { run: 'run', config: 'existing' },
      'execute',
      true
    ),
    dependencies: command(
      'plan_dependencies',
      'Preview locked dependency setup for copied source, baseline and candidate.',
      run,
      { run: 'run' }
    ),
    'install-deps': command(
      'install_dependencies',
      'Install locked dependencies in copied repositories with lifecycle scripts disabled. Invalidates prior verification.',
      {
        ...run,
        allowExecution: z.boolean().default(false),
        managerBin: text.optional(),
        offline: z.boolean().default(false),
        timeoutMs: z.number().int().min(1).max(120000).default(120000)
      },
      { run: 'run' },
      'execute',
      true
    ),
    doctor: command(
      'diagnose_environment',
      'Check prerequisites and optional model, browser and destination readiness without installing software or executing repository code.',
      {
        workspace: text.optional(),
        config: text.optional(),
        target: text.optional(),
        browser: z.boolean().default(false)
      },
      { workspace: 'existing', config: 'existing', target: 'existing' }
    ),
    capabilities: command(
      'list_capabilities',
      'List commands, schemas, effects, execution policy and supported providers.',
      {}
    ),
    schema: command(
      'get_command_schema',
      'Return the JSON Schema for a command, behavior contract or integration proposal.',
      { command: text }
    ),
    validate: command(
      'validate_transfer_contract',
      'Validate a behavior contract without executing code.',
      { contract: text },
      { contract: 'existing' }
    )
  })
);

export const proposalSchema = z
  .object({
    edits: z
      .array(
        z
          .object({
            path: text,
            beforeSha256: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .nullable(),
            content: z.string()
          })
          .strict()
      )
      .min(1)
      .max(100)
  })
  .strict();
export const jsonSchema = (schema) => z.toJSONSchema(schema);
