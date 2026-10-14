# Broader application benchmark — 14 October 2026

Two additional live model transfers into whole applications, with fresh patch replay and production browser checks. Combined with the earlier IT-Tools and TodoMVC work, four selected public app integrations have passed their declared contracts. This is not a general success-rate estimate, a cross-framework conversion test, or evidence of parity with Rea.

## Results

| Destination and task | Callable behavior before → after | Regressions, both sides | Required whole-app checks | Supplemental production interactions |
| --- | --- | --- | --- | --- |
| **drawDB** — use dequal for issue-list equality, independent of nested object-key order | **8/12 → 12/12** | **13 authored Node tests**; not an upstream suite | Full React/Vite production build | Choose PostgreSQL; create/rename a table; add/rename and type a column; reload the saved diagram and check no schema problems |
| **Mermaid Live Editor** — canonical JSON for stable Base64 and compressed share links | **4/16 → 16/16** | **164 existing Vitest tests in all 13 upstream unit-test files**, including original serialization snapshots | Full Svelte/TypeScript check; embed build; complete editor production build | Type and render a diagram; inspect the actual share-link state; reproduce it in an empty browser context |

Both exported patches were applied in fresh Git roots, reproduced the verified candidate inventories exactly, and passed their unchanged full contracts again. Production browser tests ran against these rebuilt replays on both baseline and candidate. Mermaid's baseline link was not canonical; the candidate's link was. These browser results are **supplemental online tests**, not frozen Portsmith browser-contract evidence.

Another **600 generated cases per app** passed after integration without being given to the model. drawDB checks nested structures, reordered keys and changed leaves against explicit expectations and pinned dequal. Mermaid checks canonical JSON, identical links across key orders and round trips through both codecs against pinned stable-stringify. These are bounded synthetic holdouts, not proof of arbitrary inputs or upstream library correctness.

**Engine:** 88/88 tests, zero skipped, on Node 22.19.0, 23.10.0 and 24.16.0. Public API type checks, generated command documentation, the authored transfer/export demo and the Chromium demo pass.

## Pinned repositories

| Role | Repository | Commit | Scope |
| --- | --- | --- | --- |
| Destination | [drawDB](https://github.com/drawdb-io/drawdb/tree/f7c92920faaf7aa699111a8c58eff1457ab7f6e0) | `f7c92920faaf7aa699111a8c58eff1457ab7f6e0` | Whole app: 297 tracked files, 3.64 MB before dependencies |
| Source | [dequal](https://github.com/lukeed/dequal/tree/37c21f675c1f538f2d4b63ebf19a161411e7a5fd) | `37c21f675c1f538f2d4b63ebf19a161411e7a5fd` | Original `src/index.js`, named `dequal` export; MIT |
| Destination | [Mermaid Live Editor](https://github.com/mermaid-js/mermaid-live-editor/tree/dd95c0328556e83ae42f6ee58d294c0badd922d9) | `dd95c0328556e83ae42f6ee58d294c0badd922d9` | Whole Svelte 5 app: 199 tracked files, 657 KB before dependencies |
| Source | [fast-json-stable-stringify](https://github.com/epoberezkin/fast-json-stable-stringify/tree/49e230da2c84247b29ad4de02c9395793caefd15) | `49e230da2c84247b29ad4de02c9395793caefd15` | Original CommonJS implementation and ambient declaration; MIT |

Repository size is context, not a complexity score. These tasks add different application stacks, package-format boundaries, modern test infrastructure and generated framework metadata; the transferred features remain focused utilities. fast-deep-equal was inspected but not executed or counted as a benchmark.

## Failures exposed and fixes

1. **Extensionless imports:** drawDB's utilities could not execute in native Node. A frozen `runtime.relativeImports` option now enables bounded relative-code fallback inside snapshots and Node regression workers. Bare aliases and bundler assets remain unsupported. Version-5 evidence is required; old evidence cannot authorize the option.
2. **Modern Vitest:** Portsmith previously supported only 0.34. A separate 4.1 reporter now checks real completion, exact selected files, failed hooks, crashes, empty suites, skips, TODOs and pending results. Both versions are tested using their actual runners, including negative cases. Other release families are still unsupported.
3. **Context setup:** a benchmark typo selected `types.ts` instead of `types.d.ts`. The old loop recorded three rejected setup attempts after costly preflight, without sending a model request. Context paths and size now fail before code execution, with zero proposal attempts. The invalid config and earlier session are retained.
4. **CommonJS package boundaries:** the first Mermaid integration passed bundler tests but failed native Node because a copied `.js` inherited the app's `type: module`. Preparation now preserves minimal source package-format scopes, including nested boundaries. These generated manifests contain no install scripts or dependencies, are hash-bound, and cannot be changed/deleted. Planning exposes their paths and detects collisions.
5. **Ambient types and runtime provenance:** the original stable-stringify declaration describes a named ambient module, so it cannot be imported as an ordinary relative declaration. The failed model tried reimplementation, then modifying the protected feature; both were rejected. Improved guidance produced a destination-side wrapper and declaration that reuse the unchanged implementation and original type. Runtime connection analysis now excludes erased type imports and declaration companions; source extraction still retains declarations.
6. **Framework outputs:** `.svelte-kit` is excluded generated metadata and regenerated per checkout. Svelte configuration is protected. Before freezing, the disposable Mermaid target redirects the static adapter from `docs/` to excluded `build/`; it runs the same upstream embed/editor build sequence and Svelte checks. Original source clones are unchanged.

An initial implementation test caught the generated manifest being treated as an illegal destination-test change. The fix binds these exact generated files in state; regression tests also reject deleting them. An npm 10 resolver crash during test-dependency installation was resolved using npm 11; it was not an app integration failure.

## Retained browser and harness limitations

Strict **local-only** browser runs completed the interactions but failed network checks: drawDB requests public fonts and an analytics script; Mermaid requests its public configuration schema. Those runs remain failed. Separate online production runs passed with no recorded page, request or HTTP errors. Portsmith's built-in frozen browser gate still blocks external traffic; it was not relaxed to manufacture a pass.

Exploratory UI probes also exposed invalid test assumptions: a missing readiness page, querying Monaco's hidden input rather than its visible editor, and a role locator that could not see drawDB's Add table control after a modal. The column-type extension first failed a role-based option lookup; a text-only locator then hit an existing label, leaving the saved column untyped. The stronger no-problems assertion caught it. Click-based attempts left the selector open. The final test filters the visible type selector, chooses the type with keyboard input, requires the selector to close, saves through the app command and verifies the persisted schema. Final checks use observed visible controls and wait for actual rendering/save state. Probe failures are not counted as product successes.

The first supplemental Mermaid generator accidentally expected JavaScript `-0` to survive JSON serialization. Both JSON and the pinned source serialize it as `0`. That failed harness is retained; a separate corrected suite uses JSON-parsed inputs and keeps strict equality. No frozen contract or upstream test was changed.

The final drawDB session used one model proposal. Mermaid's final session used one after three earlier provider proposals failed or were rejected. The context-typo session made no provider request. **Do not describe the overall Mermaid task as first-attempt success.** All model sessions, usage and failed proposals are in the consolidated evidence.

## Reproduce

The scripts execute reviewed repository code on the host; processes are not security sandboxes. Autonomous runs send selected files to the configured provider and consume API usage. Use Node 24.16.0 for these pinned applications; this is separate from Portsmith's Node 22+ engine support.

1. Clone the pinned repos into `.portsmith/complex-bench/repos/{drawdb,mermaid-live-editor,dequal,fast-json-stable-stringify}`. Copy the two destination apps to `targets/` under the same benchmark root.
2. In the drawDB target run `npm ci --ignore-scripts`. In the Mermaid target run `pnpm@10.34.6 install --frozen-lockfile --ignore-scripts` using its declared Node runtime.
3. In the disposable Mermaid `svelte.config.js`, change only adapter `pages: 'docs'` to `pages: 'build'`. Run SvelteKit sync and the upstream build before preparation to generate its static embed asset. Setup helpers under `test/` are then frozen by preparation; they contain no replacement feature logic.
4. Put the selected Node binary first on `PATH`, and configure `.env` and `portsmith.model.json` locally.

```sh
node scripts/benchmark-complex.mjs --case drawdb --mode prepare
node --env-file=.env scripts/benchmark-complex.mjs --case drawdb --mode run
node scripts/replay-complex.mjs --case drawdb
node scripts/browser-complex.mjs --case drawdb --network online
node scripts/holdout-complex.mjs --case drawdb

# Repeat the five commands with --case mermaid-live-editor.
node scripts/report-complex.mjs
```

Preparation creates fresh runs, explicitly copies locked dependency directories using macOS clone-copy, and records context selection. The script currently assumes macOS `cp -cR`; it is not a portable dependency installer. Replay reuses installed dependencies through links and regenerates framework metadata; it is not a clean-room dependency attestation. Frozen source/target snapshots and originals are checked before and after verification. A regression bridge observes Mermaid's actual serializer by decoding its output; it does not replace serialization.

## Local evidence

- Consolidated results and all autonomous sessions: `.portsmith/complex-bench/results.json`.
- drawDB final run: `drawdb-2P8uBJ/run`; replay: `drawdb-replay-9bsLVA`.
- Mermaid final run: `mermaid-live-editor-eDJWHY/run`; replay: `mermaid-live-editor-replay-YZ027X`.
- Each final run contains `transfer.patch`, frozen contract, inventories, original model proposals and verification reports. `*-latest.json` files locate the runs and browser artifacts.
- Failed Mermaid run: `mermaid-live-editor-0U5aHT/run`; no patch exported. Generated dependencies/build outputs from this superseded run were removed to recover disk space; code, contracts and evidence remain.
- `originals.json` records source commits/inventories. `dependency-cleanup.json` and `superseded-mermaid-cleanup.json` record removal of rebuildable artifacts only.

No originals were changed by the transfers. Nothing was published or deployed. Full upstream end-to-end suites, arbitrary monorepos, cross-framework transfers, deployment behavior and a matched comparison against Rea remain unmeasured.
