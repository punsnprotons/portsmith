# Multi-file search transfer against Rea — 2026-10-14

**Both assisted integrations passed this task on their first proposal after the UI requirement was made explicit.** This is a controlled evidence comparison with a common model and Portsmith verifier, not an independent Rea-agent contest or proof of overall parity.

## Task and pinned inputs

Move Fuse's fuzzy string search into drawDB's table/column picker. A typo such as `acount_id` must find `account_id`; selecting it must focus the existing column editor. Unrelated searches must show an empty result, clearing must restore the tree, and saved schemas must survive reload.

- Source: [Fuse v7.1.0](https://github.com/krisk/Fuse/tree/8119c18862f7df585688b1320ff307eb19f8ff89), commit `8119c18862f7df585688b1320ff307eb19f8ff89`, Apache-2.0.
- Destination: [drawDB](https://github.com/drawdb-io/drawdb/tree/f7c92920faaf7aa699111a8c58eff1457ab7f6e0), commit `f7c92920faaf7aa699111a8c58eff1457ab7f6e0`.
- Extraction: **34 unchanged original Fuse implementation files**, plus one authored callable bridge, original license and protected module scopes. This exercises a larger import graph than the prior one-file utility transfers.
- Destination setup: the existing Semi UI substring predicate was extracted into a callable helper and wired back into the same component before freezing either run. This authored baseline preparation is shared by both arms; the upstream checkout is untouched.
- Contract: 22 declared search cases, the previous 13 authored app regressions plus nine search regressions, and the full upstream Vite production build. Relative import fallback is frozen in the contract.

The bridge fixes threshold 0.3, ignores location and diacritics, and calls the original Fuse class. Other Fuse search modes, its entire upstream suite, large-dataset performance and cross-framework conversion are outside this test.

## Matched results

| Check | Portsmith-assisted | Rea-assisted |
| --- | --- | --- |
| Live model proposals | 1 | 1 |
| Source behavior | 22/22 | 22/22 |
| Baseline behavior | 14/22; genuine value gaps | 14/22; genuine value gaps |
| Candidate behavior | 22/22 | 22/22 |
| App regressions, baseline and candidate | 22/22 each | 22/22 each |
| Production builds | Passed | Passed |
| Withheld search cases | 500/500 | 500/500 |
| Browser interactions and persisted schema | Passed | Passed |
| Fresh patch application, exact inventory, tests/builds | Passed | Passed |
| Original repo inventories and Git state | Unchanged | Unchanged |

Both use `gpt-5.6-terra`, the same initial candidate inventory, frozen contract, selected files, integration goal, system prompt, three-proposal ceiling, 8,000 output-token ceiling and 1 MB context ceiling. Only the supplied static evidence differs. Each model changed the destination helper and React search component. Neither changed the source implementation, contract, tests, manifests or build configuration.

Reported usage: 50,884 tokens / 69.7 seconds for Portsmith-assisted and 71,826 tokens / 60.1 seconds for Rea-assisted. Times exclude separately captured static analysis and reflect uncontrolled host load; these are observations, not efficiency rankings. One pair cannot estimate reliability probabilities.

The 500 withheld inputs are identical across arms, not 1,000 distinct cases. They cover exact matches, one-character deletion/insertion/replacement and unrelated queries. Expected booleans are independently specified; the baseline passes 200/500 and both source/candidates pass 500/500. Node checks also ensure input objects remain unchanged.

Browser checks use real production builds, actual table/column creation, typo searches, selection focus, clearing, save and reload. Candidate empty-result behavior and baseline absence of fuzzy column matches are both asserted. Chromium traces and screenshots are retained. External public fonts/schema requests were allowed, with zero recorded page errors, failed requests or HTTP errors. These are **supplemental online browser checks**, separate from the frozen callable verification status.

## What failed and changed

The first paired pilot (`paired-JRtxU2`) passed callable checks with one small wrapper proposal in each arm. Browser work then showed that Semi UI leaves unmatched root nodes visible by default. The initial prompt only specified the callable contract and did not state the visible filtering requirement. That pilot is retained as incomplete browser evidence.

A fresh pair (`paired-8Di5I6`, protocol revision 3) received the same explicit UI goal in both arms. Both generated a destination-side filtered tree with state and preserved the existing selection handler. The frozen callable contract and regression tests were unchanged. The first browser harness also guessed the generated table name, used the wrong Search label, and raced dropdown close/focus; failures are retained. Final tests use observed accessibility labels and the real dropdown toggle with explicit state waits.

Live Rea 6.4.0 ran in the previously documented read-only Linux container. Whole-repository Fuse and drawDB analyses both reported **partial application and semantic coverage**; their full summary, module pages and outgoing traces are retained. Portsmith's selected 35-file closure had no static blockers. These different scopes do not establish analyzer equivalence.

## Setup and discovery improvements

- `init` creates a private, non-overwriting model setup directory.
- `doctor --config FILE --target DIR --browser` detects unloaded keys, invalid configs, missing Chromium/dependencies and ambiguous lockfiles, without printing credentials or running repo code.
- `discover --source DIR --query TEXT` ranks lexical entry-point candidates and reports coverage/omissions. On these pinned repos, `Fuse` ranks `src/core/index.js` first, and `tables search` ranks drawDB's actual `TablesTab/SearchBar.jsx` first. This is two observed queries, not a search-quality benchmark.
- Default named class bindings now participate in ranking; class syntax remains marked as unknown callability.
- CLI, typed API and MCP expose the same commands. The MCP transfer prompt can start from a query without an entry path.

The final full product suite passes **98/98** on Node 23.10.0; types, generated docs and the authored transfer/export demo also pass. The seven setup/discovery/MCP tests additionally pass on Node 22.19.0. The real app transfers, builds, replay and browser orchestration use Node 24.16.0. These counts are distinct from the older 93-test three-runtime validation.

## Evidence and reproduction

Local consolidated evidence: `.portsmith/search-bench/results.json`. Final pair: `.portsmith/search-bench/paired-8Di5I6`. Proof folders: `proof-portsmith-uuXBxS` and `proof-rea-cPTukP`; the former reuses its already-passed browser-v2 evidence with an unchanged candidate inventory. Failed pilots and browser probes remain under `.portsmith/search-bench/`.

Scripts: `setup-search-benchmark.mjs`, `benchmark-search-static.mjs`, `benchmark-search.mjs`, `prove-search.mjs`, `report-search.mjs`. They use the pinned local clones, the existing isolated Rea provider, prior provisioned drawDB dependencies and a configured model key. The browser helper uses workspace-local Python Playwright and the installed Chromium executable. These are benchmark fixtures, not a portable environment installer. Read scripts and authorize repository/model execution before running them.

Remaining product gaps: automatic dependency provisioning, bundler aliases/assets, general semantic search, larger contract types, broad framework conversion and the binary-analysis capabilities in Rea. No uniqueness, viral probability or general reliability claim follows from this benchmark.
