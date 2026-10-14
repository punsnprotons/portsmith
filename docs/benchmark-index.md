# MiniSearch into drawDB: dependencies, aliases and stateful search

Verified locally on 2026-10-14. Both final candidates passed the same callable contract, full app builds, browser interactions, independent holdouts and fresh patch replay. This is one matched evidence-assisted trial, not overall Rea parity or a standalone Rea-agent benchmark.

| Evidence arm | Model proposals | Contract cases | Regressions | Hidden sequences | Browser + replay |
|---|---:|---:|---:|---:|---|
| Portsmith-assisted | 2 | 26/26 | 25 | 500/500 | Pass |
| Rea-assisted | 1 | 26/26 | 25 | 500/500 | Pass |

The source passed 26/26; the baseline passed 15/26 and demonstrated value mismatches without execution errors. Both baseline and candidate passed 25 authored regression tests and full Vite production builds. Browser checks covered table/column search with typos, selecting the column and focusing its editor, empty results, clearing search, saving/reloading the schema and the Problems panel. Both final browser runs recorded zero page/request errors.

## What changed in the product

- Explicit dependency preview and locked npm/pnpm installation into copied runs, with lifecycle scripts disabled, staged replacement and verification-bound receipts.
- Local JSON/JSONC aliases in inspection, planning, preparation, Node execution and autonomous context. Source aliases become recorded relative imports, preventing destination collisions.
- Immutable copied source and inherited alias configuration. Reinstalling dependencies invalidates old verification. Failure, timeout and version mismatch remain failures.

The real pnpm check exposed incompatible npm-style config flags; the fixed adapter passed actual npm 11.6.2 and pnpm 10.34.6 installs, dependency imports, script canaries and transfer verification. Each trial arm also installed drawDB from its unchanged package-lock using npm. Registry installation and full builds succeeded with lifecycle scripts disabled. Node 24.16.0 ran the real app tests.

## Trial design

Source: [MiniSearch 7.1.2](https://github.com/lucaong/minisearch/tree/d46245015f34932058861ebeb1eb7fdf97ebaaae), five original TypeScript modules plus an authored JSON bridge. Destination: [drawDB](https://github.com/drawdb-io/drawdb/tree/f7c92920faaf7aa699111a8c58eff1457ab7f6e0), the full React/Vite application. The bridge exercises prefix/fuzzy search, AND queries across fields, add, replace, discard and ID reuse. The browser separately exercises fuzzy search through the app's table/column picker; it does not prove an incremental UI index.

Both arms use gpt-5.6-terra, identical prepared inputs, contract, selected file context, integration goal and three-proposal budget. Rea 6.4.0 supplies retained application analysis/module pages/feature traces from the same upstream revisions. Portsmith supplies its import graph. Portsmith is the common staging, model-protocol and verification engine. Rea reports partial application/semantic coverage; all original responses and their limitations are retained.

The destination static graph also reports unresolved dependency compatibility when compared in the reverse direction, including an upstream transitive icon import. That is not a claim that drawDB itself fails to build; the real locked builds pass. Static analysis and runtime proof remain separate.

Aliases are deliberately introduced in the authored boundary/configuration before freezing the run, including an independent destination @app mapping and matching Vite configuration. These are alias stress fixtures around real libraries/apps, not claims about their original alias conventions. MiniSearch's demo-data symlinks are excluded from the prepared source projection; the library source, original Git state and drawDB checkout remain unchanged. General symlink snapshots are still unsupported.

## Failures and corrections retained

The initial pilot passed callable checks but its first browser-tested candidate left unmatched root nodes visible. Revision 2 restarted both arms and made the unchanged browser requirements an in-loop acceptance gate. Portsmith's first proposal repeated that UI failure; the second repaired it. Rea-assisted adaptation passed with one proposal. No contract/test/source changes were used to make either candidate pass. This sample does not establish a reliable difference between providers.

A held-out harness initially hit its output budget while reporting expected baseline mismatches. Its output limit was raised; cases and expectations were unchanged. Final holdouts contain 500 unseen seeded stateful sequences: source/candidate passed all, baseline passed only 100. Fresh patch copies reproduced each candidate exactly and passed verification/build/browser checks with cloned locked dependency directories. Replay reuses those installations; it is not another registry install.

## Reproduce and inspect

The benchmark scripts expect the pinned local repository clones, existing Rea provider configuration and local Node/npm tools. They are reproducible developer harnesses, not a one-command fresh-machine setup. [Normal dependency and alias setup](dependencies-aliases.md) documents the product commands.

```sh
node scripts/setup-index-benchmark.mjs
node scripts/benchmark-index-static.mjs
node --env-file=.env scripts/benchmark-index.mjs
node scripts/prove-index.mjs
node scripts/report-index.mjs
```

Local, unshipped evidence:

- Setup: `.portsmith/index-bench/setup-ICpy1s`
- Final paired runs: `.portsmith/index-bench/paired-7ya31H`
- Holdouts, replays, screenshots and traces: `.portsmith/index-bench/paired-7ya31H/proof-uAQcrG`
- Real package-manager tests: `.portsmith/dependency-bench/live-btSxdk`
- Compact machine report: `.portsmith/index-bench/results.json`

Each run contains its frozen contract, dependency receipt, model contexts/proposals, verification and reviewable transfer.patch. Package receipts do not attest every installed byte. The upstream MiniSearch suite, workspace installs, private registries and arbitrary framework conversions are not covered by this trial.
