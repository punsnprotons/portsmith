# Your first transfer

Start with `npx --yes --package=portsmith-workbench@alpha portsmith-demo` for the complete no-key example. This walkthrough breaks that same authored transfer into inspectable steps. It runs only the included example code.

## 1. Get the walkthrough

Use Node 22.19+ (22.x) or 24.11+ and Git. Run these from a new source checkout:

```sh
git clone https://github.com/punsnprotons/portsmith.git
cd portsmith
npm ci --ignore-scripts
npm run demo:prepare
```

Copy the printed `export PORTSMITH_EXAMPLE='…'` line into the same terminal. It points to a fresh `.portsmith/learn-*` folder with four inputs:

| Input | Purpose |
| --- | --- |
| `source/` | Table filtering, including case and accent handling |
| `target/` | A catalog whose search currently returns every product |
| `contract.json` | Five declared cases and the existing regression command |
| `proposal.json` | Included integration edit, bound to the original file hash |

Nothing has been executed or transferred yet. The following commands use this checkout's CLI, so a global installation is unnecessary. `demo:prepare` is a source-checkout helper, not a command in the published alpha.

## 2. Find and inspect the feature

```sh
node src/cli.mjs discover --source "$PORTSMITH_EXAMPLE/source" --query filter --human
node src/cli.mjs inspect --source "$PORTSMITH_EXAMPLE/source" --entry src/filter.mjs --human
node src/cli.mjs plan --source "$PORTSMITH_EXAMPLE/source"   --target "$PORTSMITH_EXAMPLE/target" --entry src/filter.mjs --human
node src/cli.mjs validate --contract "$PORTSMITH_EXAMPLE/contract.json"
```

Read `contract.json` and `proposal.json`. The contract expects case-insensitive and accent-insensitive search, trimmed input, all rows for an empty query, and no rows for an unmatched query. These expectations are fixed before adaptation.

## 3. Prepare a copy and apply the authored proposal

```sh
node src/cli.mjs prepare --source "$PORTSMITH_EXAMPLE/source"   --target "$PORTSMITH_EXAMPLE/target" --entry src/filter.mjs   --mount src/features/table-filter --contract "$PORTSMITH_EXAMPLE/contract.json"   --out "$PORTSMITH_EXAMPLE/run"
node src/cli.mjs adapt --run "$PORTSMITH_EXAMPLE/run"   --proposal "$PORTSMITH_EXAMPLE/proposal.json"
```

Look inside `run/candidate/`. Portsmith copied the feature and applied the proposal there. `source/` and `target/` remain unchanged. Repeating preparation needs a new output directory; run `npm run demo:prepare` to start over.

## 4. Execute the checks and export

These commands execute the trusted included fixture and its existing tests:

```sh
node src/cli.mjs verify --run "$PORTSMITH_EXAMPLE/run" --allow-execution
node src/cli.mjs report --run "$PORTSMITH_EXAMPLE/run" --human
node src/cli.mjs export --run "$PORTSMITH_EXAMPLE/run"
```

Expect `verified-for-contract`: source 5/5, baseline 1/5, candidate 5/5, completed regressions. Export prints a patch path and checks that the patch reproduces the verified candidate. Read the patch before applying it; export does not change your original target.

## 5. Move to your own repositories

Choose a small JS/TS feature and a trusted destination with a supported regression command. Use `discover`, `inspect` and `plan` with your paths. Replace the example contract with expectations for your feature, then validate it. [Contract format and supported test runners](workflow.md).

For dependency-heavy projects, complete [dependency setup](automatic-setup.md) and [alias resolution](dependencies-aliases.md) before freezing a new run. Do not change protected manifests, tests or the contract to repair a frozen run.

You can author `proposal.json`, ask your [coding agent](agents.md) to produce it, or use [model-driven adaptation](autonomous.md). Existing-file edits need the candidate's current hash; new files use `null`. Model access is optional and separately authorized.

For UI behavior, add [browser cases](browser.md) to the contract before preparing. A function pass alone does not prove the UI interaction works.
