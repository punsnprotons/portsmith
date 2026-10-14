# Validation report — updated 2026-10-14

Portsmith is a local feature-transfer prototype. These results establish behavior within the supported scope; they do not establish equivalence to Rea's reliability or breadth.

## Evidence index

The alpha engine passed **149 tests**, zero failures/skips, on macOS ARM64 / Node 22.19.0 and Linux ARM64 / Node 24.11.1. See [alpha readiness](alpha-readiness.md) for clean-install evidence and remaining launch prerequisites. Historical counts below belong to their recorded milestones, not the current test total.

| Evidence | Report |
| --- | --- |
| Alpha clean source/package setup and release boundaries | [Release preparation](release.md) |
| Automatic package setup; jsondiffpatch → drawDB paired trial | [Package benchmark](benchmark-packages.md) |
| Virtual modules and planned imports | [Virtual-module benchmark](benchmark-virtual.md) |
| Dynamic/plugin aliases | [Dynamic benchmark](benchmark-dynamic.md) |
| Workspaces and Zod → Mermaid | [Workspace benchmark](benchmark-workspace.md) |
| MiniSearch/Fuse → drawDB | [Index](benchmark-index.md), [search](benchmark-search.md) |
| Larger React/Svelte apps | [Complex benchmark](benchmark-complex.md) |
| IT-Tools and TodoMVC | [First real-app benchmark](benchmark-github.md) |
| Matched evidence-assisted comparison | [Rea comparison](comparison-rea.md) |

Raw `.portsmith` paths in these reports identify private local evidence, not files shipped in the public source/package. Historical research harnesses are not clean-install entry points; see [reproduction boundaries](release.md#historical-benchmark-reproduction).

## Historical Rea comparison follow-up

- **93/93 engine tests, zero skipped**, on Node 22.19.0, 23.10.0 and 24.16.0; public types, generated documentation and the authored transfer/export demo pass.
- New tests check source-only inspection without relaxing transfer requirements, ESM/CommonJS export syntax, exact source locations, erased declarations, shadowed/nested assignments, readable CLI output and retention of rejected proposals without candidate mutation.
- The private installed tarball passes source-only inspection, authored transfer/export and its Chromium demo. All 33 installed runtime files match the source; credentials and benchmark artifacts are excluded.
- Live Rea results and controlled model runs are documented separately in [the matched comparison](comparison-rea.md); static coverage is not runtime proof.

## Version 0.5.0: broader app and module-format coverage

- **88/88 engine tests, zero skipped**, on Node 22.19.0, 23.10.0 and 24.16.0; API types and generated documentation pass.
- drawDB: 12/12 contract cases, 13 authored regressions and whole-app build. Mermaid Live Editor: 16/16 cases, all 164 upstream unit tests, Svelte type checking and both production builds. Both patches pass fresh replay.
- Supplemental online Chromium interactions and 600 generated cases per app pass. Strict local-only browser failures are retained separately; external CDN/schema dependencies remain a limitation.
- Fixes cover CommonJS/ESM package scopes, opt-in relative resolution, erased type imports, Vitest 4.1 completion, Svelte metadata and early model-context diagnostics. Generated module scopes are immutable and checked by planning.
- The authored transfer/export and Chromium demos pass. See [broader benchmark](benchmark-complex.md) for pins, failures, setup requirements and boundaries.

## Version 0.4.0: real apps and stronger verification

- **82/82 engine tests pass, zero skipped**, on Node 22.19.0, 23.10.0 and 24.11.1. Full checks also include public API types and generated documentation.
- Real Vitest 0.34 tests cover success, skipped/TODO/empty suites, assertion failures, collection crashes, process exit without completion and file-filter expansion. Protocol tests alone are not used to establish runner support.
- JavaScript extraction retains original adjacent declarations and traces runtime files when TypeScript resolves a declaration first.
- Frozen command checks cover build/type-check completion on both sides. Missing, failed, timed-out or old-version evidence blocks export. Passing command checks cannot substitute for structured regression evidence.
- Explicit context selection includes Vue/Svelte text and records omitted files. Source, target boundary and declared tests remain included; selected content over budget fails before transmission.
- Test/build/type-check configuration, manifests and locks are protected from adaptation.
- The private tarball installed offline in a separate project, passed environment diagnostics, and completed an API transfer with version-4 check evidence and a checked patch, and passed its packaged Chromium demo. Credential files and run artifacts were absent from its package file list.
- The authored transfer demo passes. [Real GitHub benchmark, setup costs, failed attempts and measured scope](benchmark-github.md) records the IT-Tools and TodoMVC work separately from fixture tests.

## Version 0.3.0: autonomous adaptation and browser evidence

Three real API-backed runs used `gpt-5.6-terra` through OpenAI Chat Completions, with every outcome retained:

| Transfer | Model edits | Outcome |
| --- | --- | --- |
| Table filtering into a browser catalog | `src/catalog.mjs` | Imported the transferred feature; Node/Chromium passed; patch exported and rechecked with the final exporter |
| Same transfer with missing input-event wiring, before the import gate | `src/catalog.mjs`, `index.html` | Behavior passed, but review found reimplementation instead of a source import; not counted as a successful source integration |
| Missing input-event wiring, with the import gate | `src/catalog.mjs`, `index.html` | Imported the transferred feature and fixed UI wiring; Node/Chromium and actual patch reproduction passed |

Each final passing example has source 5/5, baseline 1/5, candidate 5/5 function cases; two existing Node regressions pass before/after; two browser feature scenarios pass on candidate; reset regression passes on baseline/candidate. Screenshots and traces are retained and hashed. Reported tokens: 5,980, 6,272 and 6,163 respectively. Local evidence: `.portsmith/autonomous-demo-5p0177/run`, `.portsmith/autonomous-demo-5rpjDi/run` and `.portsmith/autonomous-demo-Np5gPk/run`.

Final independent patch replay applies the third patch to a fresh destination copy, compares its complete file inventory with the verified candidate, and runs Chromium and existing Node tests there. The replay outcome is recorded in `.portsmith/v030-patch-replay.json`; the earlier failed replay is preserved separately.

The complete **70/70 tests pass on macOS ARM64 with Node 22.19.0, 23.10.0 and 24.11.1**, with zero skipped tests. Public API type checks and generated documentation checks also pass. It covers repair after a bad model edit, protected-test rejection, unconnected reimplementation, exhaustion, context limits, incomplete/invalid responses, API failures/timeouts, CLI/MCP autonomy, dependency preservation, real Chromium interactions, broken wiring, page errors, browser regressions, custom app startup, timeouts and changed artifacts. Model protocol cases use a local test double; only the runs above establish live-model behavior.

Two additional failures were found through live review and patch replay:

- Git can return zero while silently skipping relative patch paths inside an unrelated parent repository. Export now creates an isolated baseline repository, applies the patch, and compares the resulting inventory with the verified candidate. An adversarial skip-with-exit-zero test fails the old exporter and passes the fix.
- A model can recreate behavior without using the transferred source. Autonomous adaptation now requires the destination entry's literal import graph to reach the copied feature. This is a static connection check, not runtime call-provenance proof.

These controlled examples do not establish a broad autonomous success rate or equivalence to Rea. No live-model repair was needed in the final passing example; repair-loop behavior is proven with controlled protocol tests.

## Previous 0.2.0 test results

| Environment | Result |
| --- | --- |
| macOS ARM64, Node 22.19.0 | 52/52 tests passed (0.2.0) |
| macOS ARM64, Node 23.10.0 | 52/52 tests passed (0.2.0) |
| macOS ARM64, Node 24.11.1 | 52/52 tests passed (0.2.0) |
| Public API types and generated command reference | `npm run check` passed |
| Local tarball installation | Installed offline; CLI version, environment doctor, API import and packaged demo passed |
| Table-filter fixture | Source 5/5; destination 1/5 before, 5/5 after; 2 existing regressions pass |
| Pinned external clsx source → owned button fixture | Source 8/8; destination 3/8 before, 8/8 after; 2 existing regressions pass |
| Portsmith MCP | Actual client/server discovery, prompt, inspect, prepare, adapt, authorized verify, export and report passed; execution unavailable by default |
| Rea adapter protocol | Linked evidence, provider failures, mismatched IDs, no-match, payload drift and process authorization covered |
| Real Rea 6.4.0, Linux ARM64 + Node 24.11.1 | Application analysis and feature trace passed for demo and external clsx source; both transfers re-verified and exported |

Commands: `npm test`, `npm run demo`, `node scripts/benchmark-clsx.mjs --source /private/tmp/portsmith-clsx-reference --allow-execution`. Both demos produce a fresh run, full per-case report and checked patch. Node 22 and 24 tests were run directly with their pinned local binaries, not inferred from CI configuration.

The 0.2.0 refactor adds shared command schemas, destination planning, diagnostics, reports and typed API declarations. New tests cover strict inputs, workspace/execution policy, license collisions, stale reports, CLI output, architecture boundaries and the complete MCP transfer. Package installation used `npm pack --ignore-scripts` and an offline install into a fresh local directory; no release was published.

The real Rea results above were captured before the 0.2.0 refactor. A fresh live-provider attempt after refactoring could not start because the local Docker daemon socket was unavailable. Protocol tests pass on the new structure, but a fresh live Rea run on 0.2.0 remains unverified. Prior evidence files were retained; this failed attempt is not a successful provider validation.

## Failures found and repaired

The original 29-test suite passed, but ten additional adversarial tests all failed before fixes. The repaired behaviors include:

- Exit-zero commands and empty, skipped or TODO test suites no longer qualify as completed regressions. Structured Node test events are required.
- Explicit regression files outside normal test directories are protected from changes.
- Files excluded from verification, such as `.env.local`, cannot leak into exported patches.
- Symlinks at output paths cannot redirect a patch write to another file.
- Valid patches larger than the 128 KB subprocess log limit can export, with a separate 32 MB bound.
- Bare Node built-ins such as `path` are recognized correctly.
- A file named `__proto__` is hashed and checked for drift like any other file.
- Diff-header normalization preserves actual file contents and nested path segments that resemble headers.
- Per-run locks prevent simultaneous mutations. Output file replacement is atomic.

Additional checks cover a complete CLI workflow through paths containing spaces, TypeScript helper imports, binary/Unicode patch application, broken source exports, broken baselines, regression failures, changed contracts, stale candidates, symlinked source files, computed imports, dependency conflicts, process timeouts and output limits.

The first Node 24 matrix attempt overlapped an npm operation replacing local runtime packages and had two subprocess failures. That overlap is the suspected cause, not a proven diagnosis. The two affected tests and then the complete suite passed after installation finished. The reported matrix above uses completed, stable runtime installations.

## Current limits

- Multiple real-app transfers are recorded, including React/drawDB and Svelte/Mermaid. These controlled tasks use authored contracts; there is no representative success rate or standalone Rea-agent parity result.
- Chromium is the only tested browser engine. Mobile and cross-browser behavior are not established.
- Completed regressions support explicit Node tests and Vitest 0.34/4.1. Other runners need adapters.
- Computed imports, general cross-framework conversion and arbitrary bundler assets are unsupported. New packages require reviewed declarations before a new run is frozen.
- Setup receipts bind manifests and locks, but installed dependency bytes and excluded generated files are not fully attested. Results concern the staged environment and selected checks.
- Trusted repository code runs on the host. File hashes detect drift, not malicious rewriting of the whole evidence directory.
- Hosted GitHub results are available in [workflow runs](https://github.com/punsnprotons/portsmith/actions/workflows/ci.yml). Check the exact commit and all four jobs; local results are not a substitute. See [release preparation](release.md) for repeatable installation gates.

See [Rea integration status](rea.md) for the separate live-provider result. No success from the protocol test double is presented as real Rea analysis.

## Virtual-module extension

See [virtual-module validation and live comparison](benchmark-virtual.md): 135 engine tests, virtual/captured-import proof version 10, Vite 4/8 fixtures, a live paired jsondiffpatch-to-drawDB integration, independent YAML/history cases, actual source-bundle behavior and fresh patch replay. Test files run sequentially to bound peak fixture disk use without changing their assertions or timeouts.

## Automatic package setup, 2026-10-14

See [the paired benchmark](benchmark-packages.md) for real npm/pnpm workspace installation (including offline repeats), npm lock recovery, automatic proposal-import discovery, owner-aware capture, two-format transfer, upstream tests, fresh patch replay and persisted browser evidence. The final validation index is `.portsmith/package-bench/completion.json`; protocol installer doubles in engine tests are separate from live package-manager evidence.
