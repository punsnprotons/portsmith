# Virtual modules, new package imports and Rea comparison

Local evidence collected 2026-10-14. Portsmith now transfers bounded plugin-generated ESM and accepts explicitly planned package imports. This comparison is one prepared transfer with two evidence-assisted model arms, not proof of general parity with Rea.

## Result

| Check | Portsmith-assisted | Rea-assisted |
|---|---:|---:|
| Initial live-model proposals | 1 | 1 |
| Additional repair after independent edge testing | 1 | 0 |
| Frozen behavior cases | 9 passed | 9 passed |
| Unchanged destination regressions | 13 passed | 13 passed |
| Full drawDB production build | Passed | Passed |
| Independently generated YAML histories | 500 passed | 500 passed |
| History transitions | 4,000 checked | 4,000 checked |
| Equality/Issues-consumer assertions | 1,500 passed | 1,500 passed |
| Empty/whitespace/comment-only/malformed streams | 4 passed | 4 passed |
| Final patch applied to fresh baseline and reverified | Passed | Passed |
| Production browser create/type/save/reload/Issues checks | Passed | Passed |

The first Portsmith-assisted wrapper rejected empty text but accepted comment-only YAML because it did not check the parsed document count. Independent tests exposed this. A second live model proposal added the missing check, then the same frozen cases, regressions and build passed again. Both final patches passed fresh replay and all independent histories. The Rea-assisted wrapper already checked the parsed count. No contract or destination test was weakened.

Separately, **412 unchanged jsondiffpatch tests** passed. A real Vite build using the source plugins succeeded, and all **nine source cases were executed against its actual emitted library bundle**, independently of Portsmith's Node alias loader. Source inventory remained unchanged. Both final replay builds also passed native Playwright table/column creation, save, reload and visible Issues-panel checks; screenshots show the persisted schema and “No problems were detected.” The engine release check passed **135 tests**, plus public API type checks and generated documentation checks. Test files now run sequentially by default to avoid overlapping large dependency copies and timing-sensitive browser fixtures.

## What makes this harder

Pinned upstreams are [jsondiffpatch](https://github.com/benjamine/jsondiffpatch), commit `a60db8a232f92ee4b987c14f43f77402885d1a5a`, and [drawDB](https://github.com/drawdb-io/drawdb), commit `f7c92920faaf7aa699111a8c58eff1457ab7f6e0`. Their implementations are reused; the feature boundary, Vite policy plugin, baseline helper and contract are authored benchmark setup.

The source uses the real `vite-tsconfig-paths` plugin plus two nested generated policy modules. Its 21-file, 63-edge feature closure includes the upstream diff/patch/unpatch engine and has zero blockers. Source capture recorded 35 pairs, two local resolutions and two generated modules; 21 unsupported/unresolved pairs remain outside the selected feature, principally unrelated tests/demos. Destination capture recorded 391 pairs, one local resolution, one planned package import and zero unsupported pairs.

The source accepts JSON snapshot arrays. The destination accepts a **YAML multi-document string** and must parse and validate it using a newly provisioned `yaml` 2.8.1 import, then call the immutable transferred engine. It also preserves `statesEqual` for drawDB's existing Issues consumer. This requires an API adapter and a new package import rather than the previous benchmark's short re-export.

The future `yaml` import was captured for `src/utils/deltaHistory.js` before freezing. Dependencies were provisioned from reviewed installed copies; the changed destination manifest was prepared before capture and its obsolete lock was removed. **This is not a new locked-install benchmark.** Production patches apply to this prepared baseline, not directly to untouched upstream drawDB. There is no new history UI; history behavior is checked through callable tests, and browser checks cover the actual existing schema/Issues workflow.

## Matching and limits

Both arms use live `gpt-5.6-terra`, the same prepared source/target, feature content, frozen contract and Portsmith execution/export judge. The supplemental static evidence differs: Portsmith feature analysis versus live Rea 6.4.0 MCP application analysis and traces. Rea runs in the existing read-only, network-disabled Docker provider. Its application and semantic coverage are reported as partial; raw results and their limitations are retained. The model projection bounds nodes/edges/paths while retaining coverage metadata. This does **not** test Rea as a standalone integration agent, and full-app analysis time is not comparable with narrow feature tracing time.

Source Vite is 8.0.3, destination Vite is 8.1.0 and `vite-tsconfig-paths` is 6.1.1. Engine fixtures also exercise Vite 4.5.14 and 8.3.4. The new five-case feature suite also passed under Node 22.19.0. A packaged-CLI check caught a missing `--virtual-modules` flag mapping; the CLI was fixed and real Vite capture fixtures now use the documented CLI options directly. Virtual loading was moved from `buildStart` into the capture entry's load phase: Vite 8 did not provide module code through the earlier hook. Tests cover nested transformed modules, generated-module package imports, planned imports from future files, stale generated content, version-9 proof refusal for new runs, missing package declarations/resolution and original preservation. Cycle and unsafe-code bounds additionally have provider unit tests.

Virtual modules are intentionally bounded ESM snapshots. Assets, `import.meta`, computed imports, arbitrary framework-generated runtime environments and automatic mid-run package installation/recapture remain unsupported. New package imports must be listed before a fresh run; frozen manifests and receipts remain protected. [Usage and limits](dependencies-aliases.md#virtual-modules-and-new-package-imports).

## Evidence and reproduction

- [Setup and pinned inputs](../.portsmith/virtual-bench/setup-latest.json).
- [Live Rea/static evidence](../.portsmith/virtual-bench/static-latest.json), raw folder `.portsmith/rea-comparison/virtual-static-xExJtD`.
- [Live model attempts and final patches](../.portsmith/virtual-bench/paired-bHCPoy/results.json); proposal 1 and supplemental repair proposal 2 are retained independently.
- [Final fresh replay and holdouts](../.portsmith/virtual-bench/paired-bHCPoy/proof-CymuEs/results.json).
- [Final production browser evidence](../.portsmith/virtual-bench/paired-bHCPoy/proof-CymuEs/portsmith-browser/candidate/result.json) and [matched Rea-assisted browser evidence](../.portsmith/virtual-bench/paired-bHCPoy/proof-CymuEs/rea-browser/candidate/result.json).
- [Actual source bundle and upstream tests](../.portsmith/virtual-bench/source-proof.json).
- [Full engine release check](../.portsmith/virtual-release-final.log).

Reproduction scripts: `setup-virtual-benchmark.mjs`, `benchmark-virtual-static.mjs`, `benchmark-virtual.mjs`, `repair-virtual.mjs`, `prove-virtual.mjs`, `prove-virtual-source.mjs`. They require the reviewed pinned dependency copies, live model configuration and optional live Rea provider described above. `browser-dynamic.mjs` runs the shared native Playwright production-browser workflow.

Some intermediate validation runs hit local disk exhaustion, and a concurrent browser fixture timed out; these remain recorded in the failed logs. Redundant dependency copies were removed and the complete suite subsequently passed with sequential test-file execution. Older trial/replay code and evidence remain, but selected redundant `node_modules` copies were reclaimed; runnable prior proof copies and final current runs remain available.
