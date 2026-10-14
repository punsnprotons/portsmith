export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface FeatureInput {
  source: string;
  target: string;
  entry: string;
  mount?: string;
  aliases?: boolean;
}
export type InspectInput = Omit<FeatureInput, 'target'> & { target?: string };
export interface PrepareInput extends FeatureInput {
  contract: string;
  out: string;
}
export interface Policy {
  root?: string;
  allowExecution?: boolean;
}
export interface FileIdentity {
  sha256: string;
  executable: boolean;
}
export interface Diagnostic {
  code: string;
  message: string;
  remediation: string;
  details: Record<string, unknown>;
  retryable: boolean;
}
export interface BehaviorContract {
  version: 1;
  source: { module: string; export: string };
  target: { module: string; export: string };
  runtime?: { relativeImports?: true; aliases?: true; capturedImports?: true; transformTypes?: true };
  cases: { name: string; sourceArgs: Json[]; targetArgs: Json[]; expected: Json }[];
  regression?: { command: string; args: string[] };
  checks?: { name: string; command: string; args: string[] }[];
  browser?: BrowserContract;
}
export interface Proposal {
  edits: { path: string; beforeSha256: string | null; content: string }[];
}
export interface ExportObservation {
  path: string;
  name: string;
  line: number;
  column: number;
  syntax: 'esm' | 'commonjs-assignment';
  typeOnly: boolean;
  from: string | null;
  callable: 'function-syntax' | 'unknown';
}
export interface Analysis {
  version: 1;
  source: string;
  target: string | null;
  entry: string;
  mount: string;
  files: { path: string; sha256: string; bytes: number }[];
  /** Older saved run analyses may predate export observations. */
  exports?: ExportObservation[];
  edges: { from: string; to: string; specifier: string; line: number }[];
  aliases?: {
    captured?: {
      generated?: { path: string; sha256: string; idSha256: string; packages: string[] }[];
      plannedImports?: { importer: string; specifier: string }[];
      mode: string;
      command: 'build';
      records: ({ importer: string; specifier: string } & (
        | { kind: 'local'; target: string }
        | { kind: 'external' | 'unresolved' | 'unsupported' | 'outside' }
      ))[];
      limitations?: string[];
    };
    providers?: string[];
    mappings: { pattern: string; target: string }[];
    files: { path: string; sha256: string }[];
    rewrites: {
      path: string;
      start: number;
      end: number;
      original: string;
      specifier: string;
      replacement: string;
      resolved: string;
    }[];
  };
  externals: Record<string, unknown>[];
  license: { declared: string | null; files: { path: string; sha256: string }[] };
  blockers: string[];
  limitations: string[];
}
export interface Plan {
  aliasRewrites: NonNullable<Analysis['aliases']>['rewrites'];
  version: 1;
  status: 'blocked' | 'ready-to-define-contract';
  source: string;
  target: string;
  entry: string;
  mount: string;
  destination: {
    packageName: string | null;
    moduleType: string;
    frameworks: string[];
    directories: string[];
    typescript: boolean;
    scripts: Record<string, string>;
  };
  files: { source: string; destination: string; sha256: string }[];
  generatedFiles: {
    destination: string;
    purpose: string;
    content: { private: true; type?: 'module' | 'commonjs' };
  }[];
  exports: ExportObservation[];
  dependencies: Record<string, unknown>[];
  license: Analysis['license'];
  blockers: string[];
  steps: { id: string; state: string; action: string }[];
  limitations: string[];
}
export interface Prepared {
  run: string;
  candidate: string;
  copiedFiles: number;
  status: 'prepared';
  next: string;
}
export interface CaseResult {
  name: string;
  status: 'passed' | 'mismatch' | 'error';
  expected?: Json;
  actual?: unknown;
  error?: string;
}
export interface BehaviorResult {
  status: 'passed' | 'failed' | 'error';
  cases?: CaseResult[];
  error?: string;
  execution: Record<string, unknown>;
}
export interface Verification {
  version: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  status: 'verified-for-contract' | 'behavior-verified-regressions-unchecked' | 'failed';
  dependencies: { sha256: string; status: 'installed'; limitations: string[] } | null;
  verifiedAt: string;
  contractSha256: string;
  candidateSha256: string;
  source: BehaviorResult;
  baseline: BehaviorResult;
  candidate: BehaviorResult;
  baselineDemonstratesGap: boolean;
  regression: Record<
    string,
    {
      status: 'passed' | 'failed';
      counts?: Record<string, unknown>;
      execution?: Record<string, unknown>;
      error?: string;
    }
  >;
  browser: BrowserVerification | null;
  checks: Record<string, { name: string; status: 'passed' | 'failed'; execution: Record<string, unknown> }[]>;
  integrity: { status: 'passed' | 'failed'; error?: string };
  upstreamAnalysis: Record<string, unknown> | null;
  limitations: string[];
}
export interface Patch {
  status: 'patch-ready';
  patch: string;
  sha256: string;
  verifiedScope: string;
  destinationChanged: false;
}
export interface TransferStatus {
  run: string;
  candidate: string;
  candidateFiles: Record<string, FileIdentity>;
  verification: { status: Verification['status']; stale: boolean } | null;
  analysis: Analysis;
  upstreamAnalysis: Record<string, unknown> | null;
}
export interface PackageImportDiscovery {
  status: 'ready' | 'blocked';
  source: string;
  dependencySource: string | null;
  proposalSha256: string | null;
  records: Array<{
    importer: string;
    specifier: string;
    manifest: string;
    name: string;
    kind: 'declared' | 'add' | 'blocked' | 'unresolved';
    range?: unknown;
  }>;
  additions: Array<{ manifest: string; name: string; range: string }>;
  blockers: string[];
  limitations: string[];
}
export interface PreparedDependencies {
  status: 'ready';
  source: string;
  original: string;
  additions: PackageImportDiscovery['additions'];
  imports: number;
  captured: boolean;
  receipt: string;
  patch: string;
  next: string;
}
export interface CommandInputs {
  'discover-imports': { source: string; proposal?: string; dependencySource?: string };
  'setup-deps': {
    source: string;
    out: string;
    proposal?: string;
    dependencySource?: string;
    cache?: string;
    capture?: boolean;
    virtualModules?: boolean;
    managerBin?: string;
    offline?: boolean;
    allowExecution?: boolean;
    timeoutMs?: number;
  };
  'capture-aliases': {
    source: string;
    out: string;
    imports?: string;
    virtualModules?: boolean;
    mode?: string;
    allowExecution?: boolean;
    timeoutMs?: number;
  };
  'auto-adapt': { run: string } & AutoAdaptOptions;
  discover: { source: string; query?: string; limit?: number };
  init: { out: string; model: string; baseURL?: string };
  inspect: InspectInput;
  plan: FeatureInput;
  prepare: PrepareInput;
  adapt: { run: string; proposal: string };
  verify: { run: string; allowExecution?: boolean; timeoutMs?: number };
  export: { run: string };
  status: { run: string };
  report: { run: string };
  'rea-trace': { run: string; config: string; allowExecution?: boolean };
  dependencies: { run: string };
  'install-deps': {
    run: string;
    allowExecution?: boolean;
    managerBin?: string;
    offline?: boolean;
    timeoutMs?: number;
  };
  doctor: { workspace?: string; config?: string; target?: string; browser?: boolean };
  capabilities: Record<string, never>;
  schema: { command: string };
  validate: { contract: string };
}
export interface CommandOutputs {
  'discover-imports': PackageImportDiscovery;
  'setup-deps': PreparedDependencies;
  'capture-aliases': {
    status: 'captured';
    source: string;
    original: string;
    mode: string;
    records: number;
    local: number;
    virtualModules: number;
    plannedImports: number;
    unsupported: number;
    receipt: string;
    next: string;
  };
  'auto-adapt': AutoAdaptResult;
  discover: Discovery;
  init: { status: 'created'; workspace: string; files: string[]; next: string };
  inspect: Analysis;
  plan: Plan;
  prepare: Prepared;
  adapt: { status: 'adapted'; edited: string[]; verification: 'required' };
  verify: Verification;
  export: Patch;
  status: TransferStatus;
  report: Record<string, unknown>;
  'rea-trace': Record<string, unknown>;
  dependencies: Record<string, unknown>;
  'install-deps': Record<string, unknown>;
  doctor: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  schema: { name: string; schema: Record<string, unknown> };
  validate: { status: 'valid'; cases: number; regressionConfigured: boolean; limitations: string[] };
}
export const version: string;
export function executeCommand<K extends keyof CommandInputs>(
  name: K,
  input: CommandInputs[K],
  policy?: Policy
): Promise<CommandOutputs[K]>;
export function commandResult<K extends keyof CommandInputs>(
  name: K,
  input: CommandInputs[K],
  policy?: Policy
): Promise<
  { ok: true; operation: K; result: CommandOutputs[K] } | { ok: false; operation: K; error: Diagnostic }
>;
export function capabilities(policy?: Policy): CommandOutputs['capabilities'];
export function schemaFor(name: string): CommandOutputs['schema'];
export function analyze(input: InspectInput): Promise<Analysis>;
export function planTransfer(input: FeatureInput): Promise<Plan>;
export function prepare(input: PrepareInput): Promise<Prepared>;
export function adapt(run: string, proposal: string): Promise<CommandOutputs['adapt']>;
export function verify(
  run: string,
  options?: { allowExecution?: boolean; timeoutMs?: number }
): Promise<Verification>;
export function exportPatch(run: string): Promise<Patch>;
export function status(run: string): Promise<TransferStatus>;
export function transferReport(run: string): Promise<CommandOutputs['report']>;
export class PortsmithError extends Error {
  code: string;
  remediation: string;
  details: Record<string, unknown>;
  retryable: boolean;
  constructor(
    code: string,
    message: string,
    remediation: string,
    details?: Record<string, unknown>,
    options?: { retryable?: boolean }
  );
}
export function diagnostic(error: unknown): Diagnostic;

export type BrowserStep =
  | { action: 'fill'; selector: string; value: string }
  | { action: 'click'; selector: string }
  | { action: 'press'; selector: string; key: string }
  | { action: 'check'; selector: string; checked: boolean };
export type BrowserAssertion =
  | { kind: 'text' | 'value'; selector: string; expected: string }
  | { kind: 'count'; selector: string; expected: number }
  | { kind: 'visible'; selector: string; expected: boolean };
export interface BrowserScenario {
  name: string;
  steps: BrowserStep[];
  assertions: BrowserAssertion[];
}
export interface BrowserContract {
  page?: string;
  server?: { command: string; args: string[] };
  cases: BrowserScenario[];
  regression: BrowserScenario[];
  actionTimeoutMs?: number;
}
export interface BrowserResult {
  status: 'passed' | 'failed' | 'error';
  error?: string;
  cases: { name: string; status: 'passed' | 'mismatch' | 'error' }[];
  regression: { name: string; status: 'passed' | 'mismatch' | 'error' }[];
  artifacts: { path: string; sha256: string }[];
  execution: Record<string, unknown>;
  browser?: string;
}
export interface BrowserVerification {
  status: 'passed' | 'failed';
  baselineDemonstratesGap: boolean;
  baseline: BrowserResult;
  candidate: BrowserResult;
}
export interface AutoAdaptOptions {
  config: string;
  allowExecution?: boolean;
  allowModel?: boolean;
  maxAttempts?: number;
  timeoutMs?: number;
}
export interface AutoAdaptResult {
  status:
    | 'verified-for-contract'
    | 'attempts-exhausted'
    | 'preflight-failed'
    | 'integrity-failed'
    | 'blocked';
  model: string;
  endpoint: string;
  attempts: { attempt: number; status: string; usage?: Record<string, unknown>; error?: Diagnostic }[];
  evidence: string;
  limits: Record<string, number>;
  patch: Patch | null;
  reason?: string;
  blockers?: { stage: string; message: string; code?: string }[];
}
export function autoAdapt(run: string, options: AutoAdaptOptions): Promise<AutoAdaptResult>;

export interface Discovery {
  source: string;
  query: string;
  totalMatches: number;
  candidates: {
    entry: string;
    sha256: string;
    score: number;
    exports: ExportObservation[];
    exportedBindings: string[];
    reasons: { term: string; match: string }[];
    inspect: { command: 'inspect'; input: InspectInput };
  }[];
  coverage: {
    status: 'partial' | 'complete-within-supported-scope';
    scanned: number;
    bytes: number;
    visited: number;
    budgetExhausted: boolean;
    omitted: Record<string, number>;
    resultsTruncated: boolean;
  };
  limitations: string[];
}
