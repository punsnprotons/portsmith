# Automatic setup: jsondiffpatch → drawDB

Measured locally on 2026-10-14. Both Portsmith and Rea-assisted adaptation passed this matched trial on their first live model proposal. This is **one transfer with authored boundaries**, not broad equivalence to Rea.

## What changed

`discover-imports` inspects proposed JS/TS edits without applying them. `setup-deps` adds missing declarations from a reviewed donor manifest, updates the owning npm/pnpm workspace, resolves and installs a lock with scripts disabled, and optionally captures future Vite imports. It produces a separate replay-checked setup patch before the contract is frozen. CLI, MCP, API types and the MCP transfer prompt expose the workflow.

The real drawDB install exposed an npm 11.6.2 issue: the first lock update retained inconsistent transitive entries, so `npm ci` rejected it. One further resolution with the same lock fixed the inconsistency. This bounded recovery applies only to pre-freeze setup with new declarations; the initial failure remains in the receipt. Frozen-run installs never regenerate locks. Tests also caught the need to select the importing workspace's manifest for package capture; root precedence now handles even single-character workspace directories.

## Same inputs and judge

- jsondiffpatch commit `a60db8a232f92ee4b987c14f43f77402885d1a5a`; drawDB commit `f7c92920faaf7aa699111a8c58eff1457ab7f6e0`.
- Unchanged diff/patch/unpatch engine, authored history boundary and two captured virtual policy modules; 21 transferred files and 63 static edges.
- Destination history API accepts YAML document streams or a JSON5 array string. Existing drawDB Issues equality consumer also delegates to the transferred engine.
- New YAML 2.8.1 and JSON5 2.2.3 imports discovered from an authored proposal, with versions from a reviewed two-package catalog. The proposal was **not applied** during setup. Destination packages were installed by npm from its updated lock, not copied from the preceding benchmark. Vite 8.1.0 production builds passed.
- Same `gpt-5.6-terra` model, source context, frozen checks and Portsmith executor. One arm receives Portsmith static evidence; the other receives live Rea 6.4.0 evidence. Both Rea traces report partial coverage. This is an evidence-assisted comparison, not a standalone Rea-agent benchmark.

| Check, per arm | Portsmith | Rea-assisted |
|---|---:|---:|
| Live proposals needed | 1 | 1 |
| Source / candidate contract cases | 18 / 18 | 18 / 18 |
| Unadapted baseline cases passed | 0 / 18 | 0 / 18 |
| Unchanged destination regressions, before and after | 13 / 13 | 13 / 13 |
| Production builds, before and after | Pass | Pass |
| Fresh integration patch replay | Pass | Pass |
| Held-out YAML / JSON5 histories | 500 / 500 | 500 / 500 |
| Invalid input / consumer assertions | 9 / 1,500 | 9 / 1,500 |
| Browser create → save → reload, baseline and candidate | Pass | Pass |

Browser checks created `customers.account_id INTEGER`, saved/reloaded it, and asserted the actual Issues consumer reported no problems. Both candidate screenshots were visually inspected. This proves the existing app interaction; no new history UI was added. History behavior is covered by callable tests. Separately, all **412 unchanged upstream source tests** passed, and the actual source Vite bundle passed all 18 source cases.

Real npm 11.6.2 and pnpm 10.34.6 workspace installs also passed, including populated-cache offline repeats, package-owner checks, absent lifecycle canaries, unapplied proposal code and unchanged originals. The Node 22 setup suite passed 9 tests. Final engine/package evidence is indexed below.

## Evidence

- Setup and separate dependency patch: `.portsmith/package-bench/setup-DsPL3F/ready-target/portsmith.setup.{json,patch}`.
- Live paired runs: `.portsmith/package-bench/paired-B0yVH6/`.
- Independent replay, holdouts, browser traces and screenshots: `.portsmith/package-bench/paired-B0yVH6/proof-gIerak/`.
- Raw Rea evidence: `.portsmith/rea-comparison/package-static-wFuYhn/`.
- Workspace install receipts: `.portsmith/package-bench/workspace-installs-latest.json`.
- Upstream/bundled source proof: `.portsmith/package-bench/source-proof.json`.
- Final validation index: `.portsmith/package-bench/completion.json`.

The full engine suite also exposed disk pressure from fixtures copying unrelated development dependencies. Vite fixtures now copy their installed dependency closure while retaining all behavior and failure assertions.

A first large install hit ENOSPC and published no output; obsolete test installations were reclaimed before the successful run. All repository code, contracts, patches and recorded evidence were retained. Historical replay dependency links were restored from their original donor installation.

Remaining boundary: unknown names require reviewed declarations; arbitrary framework aliases, computed imports and package additions after freezing do not trigger silent installation or contract changes. See [automatic setup](automatic-setup.md).
