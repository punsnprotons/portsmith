# Dynamic aliases and jsondiffpatch → drawDB

Local evidence collected 2026-10-14. This tests one prepared feature transfer, not general parity with Rea.

## Result

| Check | Portsmith-assisted | Rea-assisted |
|---|---:|---:|
| Live gpt-5.6-terra proposals | 1 | 1 |
| Frozen behavior cases | 9 passed | 9 passed |
| Destination regression tests | 13 passed | 13 passed |
| Full drawDB production build | Passed | Passed |
| Independently generated histories | 500 passed | 500 passed |
| Edit transitions checked | 4,000 | 4,000 |
| Equality/consumer assertions | 1,500 passed | 1,500 passed |
| Fresh patch replay + repeated verification | Passed | Passed |
| Browser create/type/save/reload/Issues checks | Passed | Passed |

All **412 unchanged jsondiffpatch tests** passed separately on the source; these are supplemental source tests, not 412 destination tests. The source also passed a full Vite library build. The Portsmith release suite passed **130 tests**, plus type checks, generated documentation checks and the authored transfer/export demo.

Both models produced the same short re-export to an authored source boundary. The harder parts exercised here are the 19-file TypeScript closure, production plugin resolution, array diff/patch/unpatch behavior, configuration freezing, application build and patch portability. The model adaptation itself was small; this is not evidence that either system autonomously understands or rewrites arbitrary large applications.

## Inputs and preparation

- [jsondiffpatch](https://github.com/benjamine/jsondiffpatch), commit `a60db8a232f92ee4b987c14f43f77402885d1a5a`, package 0.7.6.
- [drawDB](https://github.com/drawdb-io/drawdb), commit `f7c92920faaf7aa699111a8c58eff1457ab7f6e0`.
- Live Rea 6.4.0, the existing read-only Docker MCP provider with networking disabled.
- Node 24.16.0 for the real transfer; Vite 8.0.3 and `vite-tsconfig-paths` 6.1.1 on the source; Vite 8.1.0 on drawDB. Engine fixtures additionally cover Vite 4.5.14.

The upstream jsondiffpatch implementation is unchanged. A reviewed source boundary calls its `create`, `diff`, `patch` and `unpatch` APIs, returning latest/restored snapshots and change flags. It also exposes semantic equality. An authored async Vite config uses the actual [vite-tsconfig-paths plugin](https://github.com/aleclarson/vite-tsconfig-paths) to resolve `@delta`.

The destination starts from the earlier drawDB benchmark baseline. Preparation adds a deliberately incomplete history helper, wires the existing `arrayIsEqual` function used by the Issues component to its equality helper, and adds an async production-only resolver for `@history`. These configurations are authored benchmark adaptations, not claims about upstream drawDB's configuration. Manifests declare the source's type dependency consistently. Reviewed existing dependency installations are copied; this trial does not establish a fresh locked workspace installation.

All preparations happen before freezing the contract. The nine cases cover nested deletion, array moves/insertion/removal, repeated values, long strings, Unicode, null/root-type transitions and property-order equality. The 13 destination regressions are the unchanged authored checks from the earlier drawDB benchmark. The held-out 500 histories, with eight transitions each, additionally check input immutability and existing consumer equality without changing the frozen contract.

Patches apply to this **prepared baseline**, not directly to an untouched upstream checkout. Original Git sources are preserved. The new history boundary has no added application UI; browser proof covers the existing Issues consumer and persisted schema, while history behavior is tested through callable contracts and holdouts.

## Dynamic resolution evidence

`capture-aliases` creates a fresh copy, runs the real Vite build resolver after plugin initialization, and records per-importer resolutions. Source capture observed 34 import pairs: one local alias, with 21 unsupported/unresolved observations outside the selected feature (principally unrelated repository tests/demos). The selected 19-file closure had **zero blockers**. Destination capture observed 390 pairs with one local alias and no unsupported observations.

The actual source library build verifies the plugin mapping outside the capture harness. Baseline/candidate drawDB production builds verify the destination mapping. Capture fixtures cover async config, regex aliases returned by plugin configuration, importer-dependent `resolveId`, `buildStart` initialization, unsupported virtual imports, uncaptured imports, stale config, protected receipts, credentials exclusion, timeout, original preservation and export.

Captures are bounded build-mode observations. Virtual/generated modules, transformed relative imports, template-only imports and new bare-package importers are not general-purpose supported transfers. See [setup and boundaries](dependencies-aliases.md#dynamic-vite-and-plugin-aliases).

## Comparison controls

Both trial arms use identical prepared inputs, frozen contract, gpt-5.6-terra configuration, full feature file context, three-attempt ceiling, Portsmith adaptation protections, verification and export judge. Only their projected static evidence differs. Complete raw provider evidence is retained; projections preserve coverage and disclose truncation.

Rea analyzed the same code-only snapshots. It reported partial application/semantic coverage. Its source seed trace reported 3 nodes/2 edges, while Portsmith's literal source closure reported 19 files/61 edges. These are different abstractions and should not be compared as equivalent completeness counts. Rea's broader application analyses took about 5.9 seconds for jsondiffpatch and 15.5 seconds for drawDB; Portsmith's narrower entry closures took 49 ms and 4 ms. **These timings are not an equivalent-work speed comparison.**

An initial Rea trial included installed dependency directories and was stopped after scanning them; its evidence is retained separately. The final comparison uses code-only snapshots for both providers.

This is an evidence-assisted model comparison, not a standalone Rea-agent contest or a statistically powered reliability measurement. Rea did not implement either patch; the common model did.

## Failures found and fixed

1. **Vite 8 package entry:** newer Vite exposes its entry through package exports rather than `main`; capture now supports both layouts.
2. **Rollup/Rolldown API difference:** build watch-file inspection is optional when that API is unavailable. JSON/config inputs remain bound; arbitrary plugin filesystem reads are not automatically proven reproducible.
3. **Node 24 regression initialization:** trailing-slash directory URLs for loader registration are normalized before applying importer-specific alias restrictions. Node startup/assertion failures now retain bounded diagnostics.
4. **License discovery:** `MIT-LICENSE.txt` was omitted by the old root notice pattern. Prefixed MIT/BSD/Apache/ISC notice names are now recognized. Exact live proposals were re-staged in fresh runs after this fix, without new model calls or changed contracts; new exports contain the original notice and passed all checks again.
5. **Model context size:** captured configurations can bind many unrelated data files. Their identities remain in context, while their full contents require explicit selection.

No contract, regression, source implementation, compiler policy or type-check requirement was weakened. Initial failed preflight records remain available; only their reproducible dependency copies were removed to reclaim disk space.

## Local evidence and rerun scripts

Evidence pointers under `.portsmith/dynamic-bench/`:

- `setup-latest.json`: pinned inputs, preparation paths and original inventory.
- `static-latest.json`: final live Rea/Portsmith evidence.
- `paired-latest.json`: original live proposals and corrected final exports.
- `proof-latest.json`: fresh replay inventories, repeated verification and generated holdout results.
- `upstream-tests.json`: 412 unchanged source tests; `source-build.log`: actual source production build.
- `check-release.log`, `demo-release.log`, `node22.log`: engine/runtime validation.
- Final browser evidence is under each proof folder's `<arm>-browser-visible/`: baseline/candidate JSON results, screenshots, traces and process output.

The local benchmark helpers are `setup-dynamic-benchmark.mjs`, `benchmark-dynamic-static.mjs`, `benchmark-dynamic.mjs`, `prove-dynamic.mjs`, and `browser-dynamic.mjs`/`.py`. They depend on the reviewed repos, pinned tool installation and prior drawDB baseline described above; they are not a one-command benchmark from an empty checkout. `refresh-dynamic-exports.mjs` records the notice-fix re-staging of the already generated proposals.
