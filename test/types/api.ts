import {
  executeCommand,
  commandResult,
  type BehaviorContract,
  type Proposal,
  type Analysis
} from 'portsmith-workbench';
const input = { source: '/source', target: '/target', entry: 'src/index.ts' };
const analysis: Analysis = await executeCommand('inspect', input);
analysis.files[0].sha256.toUpperCase();
const result = await commandResult('prepare', { ...input, contract: '/contract.json', out: '/run' });
if (result.ok) result.result.candidate.toUpperCase();
else result.error.remediation.toUpperCase();
const contract: BehaviorContract = {
  version: 1,
  source: { module: 'src/a.ts', export: 'a' },
  target: { module: 'src/b.ts', export: 'b' },
  cases: [{ name: 'case', sourceArgs: [1], targetArgs: [1], expected: 2 }]
};
const proposal: Proposal = {
  edits: [{ path: 'src/b.ts', beforeSha256: null, content: 'export const b = 2;' }]
};
void contract;
void proposal;
const sourceOnly = await executeCommand('inspect', { source: '/source', entry: 'a.ts' });
sourceOnly.exports?.map((item) => item.name);
// @ts-expect-error a target is still required for transfer planning
await executeCommand('plan', { source: '/source', entry: 'a.ts' });
// @ts-expect-error a feature entry remains required for inspection
await executeCommand('inspect', { source: '/source' });
// @ts-expect-error unknown command names are rejected
await executeCommand('invented', {});
// @ts-expect-error timeout must be numeric
await executeCommand('verify', { run: '/run', timeoutMs: 'later' });

executeCommand('auto-adapt', {
  run: '/work/run',
  config: '/work/model.json',
  allowModel: true,
  allowExecution: true,
  maxAttempts: 2
});
// @ts-expect-error model config is required
executeCommand('auto-adapt', { run: '/work/run' });

const discoveries = await executeCommand('discover', { source: '/source', query: 'search', limit: 5 });
discoveries.candidates[0].inspect.input.entry.toUpperCase();
await executeCommand('init', { out: '/new', model: 'configured-model' });
await executeCommand('doctor', { config: '/model.json', target: '/app', browser: true });
// @ts-expect-error initialization requires an explicit model
await executeCommand('init', { out: '/new' });

await executeCommand('inspect', { ...input, aliases: true });
await executeCommand('dependencies', { run: '/run' });
await executeCommand('install-deps', {
  run: '/run',
  allowExecution: true,
  managerBin: '/npm',
  offline: true
});

// New capture options and proof version are part of the public API.
const generatedCapture = await executeCommand('capture-aliases', {
  source: '/reviewed-source',
  out: '/fresh-copy',
  imports: '/planned-imports.json',
  virtualModules: true,
  allowExecution: true
});
generatedCapture.virtualModules.toFixed();
generatedCapture.plannedImports.toFixed();
const capturedRuntime: NonNullable<BehaviorContract['runtime']> = { aliases: true, capturedImports: true };
const capturedProofVersion: import('portsmith-workbench').Verification['version'] = 10;
void capturedRuntime;
void capturedProofVersion;
const importPlan = await executeCommand('discover-imports', {
  source: '/app',
  proposal: '/edits.json',
  dependencySource: '/donor'
});
importPlan.additions[0]?.manifest.toUpperCase();
const preparedPackages = await executeCommand('setup-deps', {
  source: '/app',
  out: '/ready',
  proposal: '/edits.json',
  dependencySource: '/donor',
  cache: '/cache',
  offline: true,
  capture: true,
  allowExecution: true
});
preparedPackages.source.toUpperCase();
preparedPackages.patch.toUpperCase();
