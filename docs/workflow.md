# Transfer workflow

## 1. Declare the behavior before editing

A contract names one exported function in each repo and the behavior expected from both. Arguments can differ to accommodate the destination API. Expected values are explicit, not inferred from whatever the candidate happens to return.

```json
{
  "version": 1,
  "source": { "module": "src/filter.mjs", "export": "filterRows" },
  "target": { "module": "src/catalog.mjs", "export": "searchCatalog" },
  "cases": [
    {
      "name": "case-insensitive search",
      "sourceArgs": [[{"id": 2, "name": "Tea leaves"}], "TEA"],
      "targetArgs": ["TEA"],
      "expected": [{"id": 2, "name": "Tea leaves"}]
    }
  ],
  "regression": { "command": "node", "args": ["--test", "test/catalog.test.mjs"] }
}
```

Use multiple meaningful cases, including empty input and edge cases. Contracts support JSON values only. The runner awaits async functions and compares actual return values with strict deep equality. Exceptions and missing exports are execution errors, never evidence that a feature is simply absent.

Regression evidence supports **`node --test FILE...`** using Node's `test()` API and **`node node_modules/vitest/vitest.mjs run [--environment=jsdom|node] FILE...`** for Vitest 0.34.x and 4.1.x. File paths must be explicit. Structured reporters count actual tests and reject empty suites, failed hooks, collection errors, skips, TODOs, crashes and incomplete results. The Vitest adapter also requires collected files to match the declared selection exactly. Other runners, arbitrary npm scripts and globs are not regression evidence. Tests run without a shell.

Add mandatory build, lint or type checks to the frozen contract when needed:

```json
"checks": [
  { "name": "TypeScript", "command": "npm", "args": ["run", "typecheck"] },
  { "name": "Production build", "command": "npm", "args": ["run", "build"] }
]
```

Each check must exit successfully without timeout or output-limit failure on both baseline and candidate. Checks supplement structured regression evidence; they cannot replace it. These are declared-command completion checks, not independent proof of what an arbitrary command validates. Commands that generate tracked files fail the integrity gate; generate required upstream files before freezing a fresh run, or configure output into excluded build/cache directories. Vite/Vitest/Webpack/Svelte and TypeScript configuration files, package manifests and dependency locks are protected from adaptation. Resolve dependency changes before freezing the run.

## 2. Inspect and prepare

If the source entry is unknown, run `discover --source DIR --query "feature terms" --human`. It ranks JS/TS files by export names, paths and source terms, without execution. Read its coverage and inspect a selected entry before planning. No matches cannot prove absence.

Use `init --out NEW_DIR --model MODEL_ID` to create a private configuration template. Run `doctor --config FILE --target DIR --browser` with your private environment loaded to check local setup. These optional checks do not contact the provider or execute repository code.

Run `doctor` to check local prerequisites and `plan` to inspect destination conventions, proposed file paths and collisions. Use `schema --command contract` to discover the contract format and `validate --contract FILE` to check its shape before preparation. These operations do not execute repository code; planning does not generate integration edits.

`inspect --source DIR --entry FILE` works without a destination. Dependency compatibility is explicitly marked not compared; supplying `--target` enables that comparison. `plan` and `prepare` still require a target and preserve all dependency gates.

`inspect` reports top-level export names and source locations alongside its import trace. Type-only exports are marked; a function-syntax hint does not prove runtime callability. Dynamic exports and transitive re-export resolution remain unknown. These observations help select a contract boundary; verification still executes its exact exported callable.

`inspect` traces whole files, not function slices. Relative imports preserve their directory layout under the chosen mount. Adjacent `.d.ts`, `.d.mts` and `.d.cts` declarations accompany JavaScript implementations. Runtime files are retained when TypeScript resolution prefers a declaration. Aliases require explicit enablement and local data-only configuration; unsupported mappings, computed imports and non-code assets block preparation. Dependencies must have identical declared version ranges in both root manifests; this is deliberately conservative and is not a installed-version compatibility check.

`prepare` creates:

```text
transfer-001/
  source/              source snapshot for behavior checks
  baseline/            unchanged destination snapshot
  candidate/           destination copy plus extracted feature
  contract.json        frozen contract
  state.json           analysis, original file hashes, limitations
```

Snapshots exclude `.git`, `node_modules`, `.env*` files, `.portsmith`, `dist`, `build`, `coverage`, `.next` and `.svelte-kit`. Symlinks and special files are rejected. Limits: 300 feature files, 2 MB per feature file; 5,000 snapshot files, 10 MB per snapshot file, 100 MB per snapshot. Limits fail explicitly rather than truncate.

The copied source root license and notice files stay beside the feature. Provenance records the source path and file hashes. This does not decide license compatibility or identify every nested/per-file license. Review notices and remove private local-path metadata if necessary before publishing a patch.

Preparation does not install dependencies. Preview with `dependencies --run DIR`, then provision supported frozen npm/pnpm lockfiles with `install-deps --run DIR --allow-execution`. Lifecycle scripts are disabled. An installation receipt binds manifest/lockfile hashes and successful completion to subsequent verification/export; failed or repeated setup invalidates old verification. `node_modules` bytes remain excluded from snapshot hashing, so a receipt is not full dependency-content attestation. The portable demo avoids dependencies in both fixture repos.

## 3. Adapt to the destination

A developer, the host coding agent, or `auto-adapt` produces an integration proposal. The autonomous command requests a proposal from the configured model, verifies it, and repairs failures within a bounded attempt limit. It requires explicit model and execution authorization; see [autonomous setup](autonomous.md). Valid model proposals are saved before protected-file validation, including rejected edits, so the repair history remains reviewable. Rejected protected edits do not mutate the candidate. The proposal format is:

```json
{
  "edits": [
    {
      "path": "src/catalog.mjs",
      "beforeSha256": "the-current-candidate-file-sha256",
      "content": "the complete replacement file contents\n"
    }
  ]
}
```

`status --run DIR` lists current hashes. Use `null` for a new file. All edits are validated before the candidate is replaced. Existing-file deletions are not available through proposals in this version. You may edit the candidate directly, but it must be verified again afterward.

Files in `test`, `tests`, `spec`, `specs`, `__tests__`, `__snapshots__`, named `*.test.*` / `*.spec.*`, or explicitly selected by the regression command cannot change. This does not identify every transitive test helper; review the diff and regression command. Baseline/source snapshots and originals must remain unchanged.

## 4. Verify and export

`verify --allow-execution` runs code on the host. It strips inherited environment variables except PATH, supplies a test environment, bounds output and applies a per-process timeout. These measures are not containment: trusted code can still access disk and network. Never execute an unfamiliar public repository merely because analysis succeeded.

Export requires all of these:

1. Source passes every contract case.
2. Destination baseline has at least one value mismatch and no execution errors.
3. Candidate passes every contract case.
4. The supported regression runner reports completed, non-empty, passing tests on baseline and candidate, with none skipped or marked TODO.
5. Optional frozen browser cases demonstrate a baseline gap and pass on the candidate; browser regressions pass on both.
6. Tracked originals/snapshots, contract and destination test files stay unchanged; candidate does not mutate during execution.
7. Every additional declared check completes successfully on both baseline and candidate.
8. Candidate hashes still match the verification record and applying the patch to an isolated baseline copy reproduces the verified candidate inventory.

Statuses:

| Status | Meaning | Patch export |
| --- | --- | --- |
| `verified-for-contract` | All applicable gates can be satisfied for declared scope | Allowed after freshness/apply checks |
| `behavior-verified-regressions-unchecked` | Behavior passes but no regression command was supplied | Blocked |
| `failed` | Behavior, baseline evidence, integrity or regression gate failed | Blocked |

Reports preserve per-case outcomes, subprocess commands, exit codes, stdout/stderr, timeouts and limitations. Hashes detect ordinary drift; they are not signed attestations and are not tamper-proof against code or a person who can edit the entire run directory. A pass proves only the cases and tests actually run, not general equivalence, security, browser usability or production readiness.

Use `report --run DIR --human` for a concise summary and `status --run DIR --json` for current file hashes and evidence freshness. CLI, MCP and the public API share these workflows; MCP execution requires startup authorization and an explicit per-call flag.

Portsmith exports a patch from fresh copies of the **verified file inventories**. Excluded files in the execution directories cannot enter that patch. Output writes reject symlinks and replace files atomically. Binary data, Unicode paths and filenames containing spaces are covered by application tests. Patch output has a separate 32 MB limit; ordinary subprocess logs remain capped at 128 KB.

Portsmith does not apply patches to the original app. A per-run operation lock rejects concurrent adaptations, verifications, exports and Rea captures. After an interrupted process, a stale `.portsmith-operation.lock` must be removed manually only after confirming its recorded process has stopped. Verification records from the initial prototype (version 1) require re-verification under the gate selected by the current frozen contract (versions 2–6).

Browser contracts produce verification version 3 and bind screenshots/traces to export checks. Existing function-only contracts retain version 2 compatibility. A version 2 record cannot authorize export of a browser contract. See [browser configuration](browser.md).

Export validates an actual application in a temporary Git repository, so Git cannot silently skip paths because of an unrelated ancestor repository. When applying manually, work from the destination repository root; if the destination is a subdirectory of another repository, use the appropriate `git apply --directory=...` prefix from that root.

Contracts with additional `checks` produce verification version 4, with or without browser cases. Earlier evidence versions or missing check results cannot authorize their export. A new or changed check requires a new run.

## Extensionless relative imports

Apps that use imports such as `./utils` or `./folder` can opt in before preparation:

```json
"runtime": { "relativeImports": true }
```

The Node callable runner and Node regression runner first try native resolution, then look for relative `.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`, `index.js`, `index.mjs`, or `index.ts` files inside the snapshot. The fallback never resolves bare aliases, assets, dependency internals, or paths outside the snapshot. Native Node resolution is otherwise unchanged; this is not a security boundary or a bundler emulator. TypeScript still depends on the selected Node runtime's support. Vitest continues to use its own project resolution.

This choice is frozen and produces verification version 5. Version 4 evidence cannot authorize a run that enables it. Runtime import-connection checks exclude erased TypeScript imports; a type-only reference to a feature does not prove a runtime connection. Source extraction still retains and validates declarations.

Svelte's `.svelte-kit` output is excluded generated execution metadata, like `.next`; its source configuration remains protected. Generate framework metadata when provisioning each snapshot. Build outputs must use excluded output folders. Model context paths and size are checked before executing repository code, so a setup typo cannot consume integration attempts.

Minimal generated `package.json` files preserve source module-format scopes at the feature mount and any traced nested package boundary. They contain only `private: true` and the original explicit `type`, when present. An unspecified source type stays unspecified rather than inheriting the destination's type. Installation scripts, dependency manifests and package entry-point maps are not copied. These scope files are shown by `plan`, hash-bound in the run and protected from edits or deletion. Original code and declarations remain unchanged. An ambient declaration (for example, `declare module 'package-name'`) can require a small destination-side wrapper and declaration; the autonomous prompt explains how to reuse its original type instead of rewriting the feature.


## Local and framework aliases (verification version 9)

Set `"runtime": { "aliases": true }` before preparation and pass `--aliases` to `inspect`/`plan`. Read-only analysis and the Node runners use data-only mappings from `portsmith.aliases.json`, otherwise root TypeScript/JavaScript configuration and supported static Vite/SvelteKit 2 aliases. Source alias imports are rewritten to relative imports while copying the immutable feature, with the exact rewrites recorded in provenance and the exported patch. Originals remain untouched. Destination mappings are independent and are included in selected autonomous context.

Static mappings support only exact names and trailing `/*` mappings with one local target are supported. Local JSONC inheritance is bounded to eight files. Package/framework config execution, fallback arrays, CommonJS alias loading, assets and paths outside the snapshot are refused. Native TypeScript execution still depends on the selected Node version; this is not a transpiler. Vite/Vitest/framework resolution must be configured explicitly before freezing a run. Alias configuration never silently changes a failed contract. [Setup details](dependencies-aliases.md).

## Non-erasable TypeScript (verification version 8)

A new contract can set `runtime.transformTypes: true` to enable Node's experimental TypeScript transform for callable checks and Node regressions. This supports enum syntax such as Zod's compatibility exports. It does not change the contract, tests, or framework build configuration. Unsupported Node versions fail explicitly. Checks using their own commands must declare the flag themselves.


## Captured plugin resolutions

For reviewed dynamic Vite configuration, run `capture-aliases` with explicit execution authorization before preparing a run. Use its new copy and freeze `runtime.aliases: true` plus a real production build check. Importer-specific local observations support callbacks, regex aliases and plugin resolution; unsupported/uncaptured imports fail explicitly. Config and captured data remain immutable during adaptation. Alias-enabled runs now require verification version 9, including combinations with `transformTypes`; older evidence cannot authorize export. [Capture workflow and limitations](dependencies-aliases.md#dynamic-vite-and-plugin-aliases).


## Frozen virtual modules and planned imports (version 10)

`capture-aliases --virtual-modules` can materialize bounded plugin-generated ESM. `--imports FILE` resolves exact future package imports before a run is frozen. Install any new packages in the reviewed setup copy first. Both features require `runtime.aliasases: true`, `runtime.capturedImports: true` and production build checks in a **new contract**. Version 9 evidence cannot authorize these runs. Generated modules, receipts, dependency manifests and tests remain protected; other new bare imports still fail. See [setup and limits](dependencies-aliases.md#virtual-modules-and-new-package-imports).

### Automatic preparation before freezing

Use `discover-imports` to inspect a JS/TS proposal and `setup-deps` to add reviewed donor declarations, resolve/install npm or pnpm dependencies in a fresh copy, and optionally capture future Vite imports. Review the separate setup patch, then prepare a new run from the returned copy. Setup never applies the proposal or changes a frozen run; source pass, destination gap, candidate pass and unchanged regressions remain mandatory. See [automatic setup](automatic-setup.md).
