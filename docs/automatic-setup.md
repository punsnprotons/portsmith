# Automatic package setup before verification

Use `setup-deps` before `prepare` when integration needs new packages. It discovers literal JS/TS package imports from an ordinary proposal, obtains missing declarations from a reviewed donor repository, updates the owning workspace manifest, resolves a lock, and performs a frozen npm/pnpm install in a fresh copy. Neither originals nor proposal code are changed.

```sh
portsmith discover-imports --source ./app --proposal ./proposal.json --dependency-source ./donor
portsmith setup-deps --source ./app --out ./ready-app --proposal ./proposal.json \
  --dependency-source ./donor --capture --allow-execution
```

`--capture` also captures exact future importer/specifier pairs through installed Vite plugins. Add `--virtual-modules` for supported generated ESM. Use the returned copy as the destination of a **new** run; declare `runtime.aliases`, `runtime.capturedImports` and production build checks. Source preparation can use the same setup command independently.

Review `portsmith.setup.json` and `portsmith.setup.patch`. The patch contains only manifest/lock changes, is replay-checked during setup, and must be applied before the later integration patch. `portsmith.imports.json` contains discovered pairs. The proposal is inspected for imports but not applied: the baseline must still demonstrate the missing feature. Setup success is not behavior verification.

## Boundaries

- Existing destination declarations take precedence. Missing declarations must have one unambiguous registry version/range in the donor's root or workspace manifests. Unknown aliases/private names are never guessed as public packages. A small reviewed package manifest can serve as a dependency catalog.
- Static literal imports, re-exports, `require` and dynamic `import('literal')` are discovered, including scoped subpaths and type imports. Computed imports, unknown framework aliases and non-JS/TS proposal edits produce diagnostics. With no proposal, discovery scans repository JS/TS, which may require resolving unrelated example or test imports first.
- npm and pnpm workspaces are supported. Additions go to the importing member. npm/pnpm executables must already exist; `--manager-bin` selects one, and declared exact manager versions are enforced.
- Lifecycle scripts and pnpm hooks are disabled; package installs receive no model/browser credentials or repository `.npmrc`. Only public registry dependencies and supported workspace links are provisioned. This is a separate process, **not a sandbox**.
- A valid existing lock is installed unchanged when no additions are needed. With new declarations, resolution may update transitive dependencies; every changed manifest/lock appears in the setup patch. If npm rejects its updated lock with `EUSAGE`, setup performs one additional resolution and frozen-install attempt, recording the initial failure. It never repairs a frozen transfer run.
- `--offline` requires a populated cache. Supply an existing cache/store with `--cache PATH`, outside the source and output. Failures publish no prepared copy; caches can retain public package data.
- Subpath exports and runtime compatibility still require capture, production build and behavior checks. A model that introduces an uncaptured import after freezing needs a new proposal/setup/run. Setup does not silently restart or relax a frozen contract.

Package-manager behavior: [npm install](https://docs.npmjs.com/cli/v11/commands/npm-install/) and [pnpm install](https://pnpm.io/cli/install).
