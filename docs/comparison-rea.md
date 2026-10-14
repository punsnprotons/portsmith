# Matched Rea comparison — 14 October 2026

This compares installed **Rea 6.4.0** and Portsmith on the exact drawDB, Mermaid Live Editor, dequal and stable-stringify commits in [the broader benchmark](benchmark-complex.md). It separates live static analysis from model-assisted integration and independent execution. It does not establish equal reliability, usability or breadth across arbitrary repositories.

## What was compared

1. **Live analysis:** Rea analyzed all four unchanged repositories through its actual MCP server in an isolated Linux container. Portsmith traced the corresponding feature entry points. Rea's whole-application scope and Portsmith's import closure are different, so their times and file counts are not a speed or coverage ranking.
2. **Controlled integration:** both arms receive the same source code, staged feature, target files, frozen contract, model (`gpt-5.6-terra`), system instructions, output limit and three-proposal budget. One arm receives Portsmith's static analysis; the other receives Rea's retained analysis and trace. The order alternates between apps. Each arm starts from a fresh copy; initial inventories and contract hashes must match.
3. **Independent checks:** the common Portsmith judge runs source/baseline/candidate cases, original protected regressions and full build/type commands. Successful patches are independently applied and verified again, followed by production Chromium interactions and 600 withheld generated cases per candidate.

This is **Portsmith-assisted versus Rea-assisted adaptation using a common model and Portsmith judge**, not an end-to-end contest between independent agents. Rea supplies investigation tools; a host agent implements and tests the result. Its [bundled guidance](../.portsmith/providers/node_modules/rea-agents/skills/reverse-engineer-anything/SKILL.md) recommends ordinary source tools for complete source repositories. The explicit comparison request is why these source trees were also supplied to Rea.

The static input paths and task boundaries were selected in advance. This does not measure blind feature discovery. No holdout inputs or previous successful proposals were supplied to the model. Provider caching and machine load are uncontrolled; one pair per task cannot estimate success probability or establish a timing advantage.

## Integration pilot

| Task | Portsmith-assisted | Rea-assisted | Frozen checks |
| --- | --- | --- | --- |
| drawDB issue equality | Passed, one proposal | Passed, one proposal | 12 behavior cases; 13 authored regressions; complete production build |
| Mermaid stable share links | Passed, two proposals | Passed, two proposals | 16 behavior cases; all 164 upstream unit tests; Svelte type check; embed/editor builds |

Both Mermaid pilot arms first proposed an edit inside the immutable feature subtree. The checker rejected those proposals, and each model's second proposal used a destination-side adapter. This is recovery within the declared attempt budget, not first-attempt success. All four pilot patches also passed fresh replay, production browser interaction and 600 generated holdout cases each.

Pilot total provider-reported tokens were 14,460 versus 46,593 for drawDB, and 61,337 versus 107,956 for Mermaid (Portsmith versus Rea-assisted). The Rea projection supplied substantially more static material; these numbers describe this harness, not general product efficiency. Wall times were 57/62 seconds and 297/283 seconds respectively, excluding separately captured static analysis and subject to uncontrolled machine load. They are not performance rankings.

## Corrected Mermaid rerun

Both arms again passed in **two proposals**, using the same frozen contract and improved rejection diagnostics. The first proposal in each arm tried to add an adapter inside the immutable feature subtree; the second placed it outside. Rea-assisted usage was 107,977 reported tokens; Portsmith-assisted usage was 62,565. Observed wall times were 342 and 379 seconds respectively, with other validation work running on the host. These are retained run measurements, not a speed or token-efficiency ranking.

The rerun used the new export observations in Portsmith's source context. Source-only inspection was added afterward and separately exercised on all four original repositories; the matched transfer arms still supplied explicit destinations. The rerun protocol records the exact engine file inventory used when it began.

All six candidates across the pilot and rerun pass independent patch replay, production browser checks and 600 holdout cases each. The same 600 generated cases per app are reused across its candidates; this is not 3,600 distinct input cases. Original repository inventories and Git worktrees remain unchanged.

## Static findings

| Input | Rea application coverage | Rea module trace | Portsmith observation |
| --- | --- | --- | --- |
| drawDB whole app | Partial: semantic/result resource limits; 252 JavaScript files parsed | Partial | Traced the selected utility's three-file import closure |
| Mermaid whole app | Partial; 79 JavaScript files parsed and one parse failure | Partial | Identified the boundary but blocked its type alias and dependencies missing from the comparison destination |
| dequal | Complete application inventory; semantic coverage still unknown | Complete within supplied source | One runtime feature file |
| stable-stringify | Complete application inventory; semantic coverage still unknown | Complete within supplied source | Runtime feature and original adjacent declaration |

Rea does not hide these unknowns. Its summary view may be complete **within that view** while the underlying application remains partial. Portsmith's absence of import blockers is likewise not whole-app or runtime coverage.

Following Rea's recovery guidance, a fresh drawDB copy containing the three unchanged relevant source files plus root manifest/license produced complete application coverage and a complete-within-source trace (74 nodes, 97 edges). The scope was selected using Portsmith's closure, so it is a focused recovery check, not independent discovery or whole-app completeness. Rea's detailed source locations and named export observations were useful even though broader semantic inference remains bounded.

## Product gaps fixed

- **Source-only inspection:** a destination is no longer required just to explore a source feature. Without one, dependency compatibility is explicitly unassessed; transfer planning and preparation still require the destination. The earlier static comparison supplied the other app solely because the old API required it; those dependency conflicts were not transfer failures.

- **Boundary discovery:** `inspect` and `plan` now include named export observations, file/line/column locations, type-only markers and function-syntax hints. Human CLI output shows the source files and entry exports. This makes selecting a behavior-contract boundary easier.
- **Incorrect import locations:** AST leading trivia previously caused several imports to report the preceding line. Locations now start at the actual import syntax.
- **Incomplete repair evidence:** autonomous adaptation now saves every valid model proposal before protected-file validation. Rejected edits remain reviewable while the candidate remains unchanged.

Export hints are syntax observations, not guaranteed runtime callability. Dynamic/conditional CommonJS exports and transitive re-export resolution remain outside this feature. Runtime verification still rejects missing or throwing exports. A type declaration never becomes runtime evidence.

After these changes, the named runtime export observations agree with Rea at all four selected boundaries: 18 drawDB exports (focused scope), three Mermaid exports, dequal and the CommonJS default export. Type-only declarations remain separate. This agreement does not establish general analyzer equivalence.

The comparison harness initially returned a generic assertion for protected edits and failed to retain rejected proposals. That pilot remains recorded. Revision 2 returns the exact protected path and retains each proposal for **both** arms; the affected Mermaid pair is rerun in fresh directories. No contract or upstream test is weakened. The original pilot and corrected Mermaid pair are both included in the consolidated report; the rerun does not erase the pilot.

## Evidence and reproduction

All credentials stay in `.env` and never enter candidate inventories or patches. Original clones stay unchanged. Rea runs with a read-only provider/source, disabled network, dropped capabilities and a temporary provider home. The installed Docker runtime was started for this comparison; no user agent registration or host compiler configuration was changed.

Local evidence is under `.portsmith/rea-comparison/`: `catalog.json` is the observed MCP schema, `static-latest.json` locates live analysis, `focused-latest.json` locates recovery, and `results.json` consolidates both paired directories. Paired directories contain the preregistered protocol, matching-input hashes, every retained attempt, usage, verification and checked patches. Failed/partial observations remain separately recorded. `proof/` contains fresh replay, Chromium and holdout evidence.

After provisioning the exact repositories and dependencies described in [the broader benchmark](benchmark-complex.md), and setting the local `config.json` to the installed Rea MCP command:

```sh
node scripts/benchmark-rea-static.mjs
node scripts/benchmark-rea-focused.mjs
node --env-file=.env scripts/benchmark-rea.mjs
node scripts/prove-rea-comparison.mjs
# Pass every trial directory, including earlier pilots:
node scripts/report-rea-comparison.mjs /path/to/pilot /path/to/rerun
```

Use Node 24.16.0 for the pinned applications. The setup currently uses macOS clone-copy and reused locked dependencies; it is not a portable installer or clean-room dependency attestation. Execution and API usage require authorization. Timing includes setup/model/check work but excludes the separately captured Rea static analysis. The consolidated report command takes all trial directories explicitly so pilot results are not lost when a rerun updates the latest pointer.

Remaining gaps include full-repo feature search, automatic dependency/environment provisioning, aliases and bundler assets, native/binary investigation, broader browser/network policies and general cross-framework conversion. Rea has capabilities outside Portsmith's transfer scope. The shared browser checks use online public assets; the strict offline limitation from the previous benchmark remains.

The final local directories are `paired-d1hdL4` (four-arm pilot) and `paired-LwjPkJ` (corrected Mermaid pair). Engine checks pass 93/93 with zero skipped tests on Node 22.19.0, 23.10.0 and 24.16.0. API types, generated CLI documentation, the authored demo, and fresh installed-package inspection/transfer/Chromium checks pass.

## Follow-up: multi-file search and easier setup

The [Fuse-to-drawDB comparison](benchmark-search.md) adds a 34-file source implementation, model-generated React search wiring, fresh paired runs, 500 withheld cases, browser interaction/reload checks and patch replay. It also adds repository-wide lexical discovery, private setup generation and expanded local readiness checks. Both assisted arms pass that selected task; it does not establish overall Rea parity.


The newer [MiniSearch stateful-index comparison](benchmark-index.md) adds local aliases, actual locked dependency installation, stateful index cases and in-loop browser repair. It remains a matched evidence-assisted trial, not proof of overall Rea parity.

The [workspace and SvelteKit comparison](benchmark-workspace.md) adds npm/pnpm workspace installs, static framework aliases, a 73-file Zod closure, and explicit TypeScript transformation. It records failed model proposals and the follow-up wrapper repair rather than counting only final successes.
