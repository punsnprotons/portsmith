# Setup and feature discovery

From a checkout, install with `npm ci --ignore-scripts`, then run `npm run demo`. The demo needs Node 22+, Git and no API key.

For autonomous work, `node src/cli.mjs init --out /work/new-setup --model YOUR_MODEL_ID` creates a new private directory containing a model config, `.env.example`, `.gitignore` and next steps. Existing directories, files and symlinks are refused. Supply `--base-url https://your-provider/v1` for another OpenAI-compatible endpoint. Choose a model your provider supports; initialization cannot validate access.

Copy `.env.example` to `.env` and add the key locally. Load it with Node's `--env-file` option. Portsmith never automatically reads `.env` or writes keys into configuration. Do not pass a key as a CLI flag.

```sh
node --env-file=/work/new-setup/.env src/cli.mjs doctor \
  --config /work/new-setup/portsmith.model.json --target /work/app --browser --human
```

Optional doctor checks report invalid configuration, an unloaded key, missing Chromium, missing destination dependencies and multiple package-manager lockfiles. It also reports declared Node and package-manager requirements, workspace member counts and dependency directories. Member-only dependencies are detected. A present dependency directory does not prove correct versions. Browser presence does not prove it can launch. Provider authentication, Rea setup and actual execution are separate checks.

Install Chromium from the Portsmith checkout with `npm run browser:install`. Review each repository's scripts and lockfile before provisioning dependencies in disposable snapshots. Dependencies are deliberately not installed by doctor or init. After preparing a run, use `dependencies --run DIR` for a read-only plan and `install-deps --run DIR --allow-execution` for supported frozen npm/pnpm installs. [Dependency and alias setup](dependencies-aliases.md).

## Find an entry point

```sh
node src/cli.mjs discover --source /work/source --query "search" --limit 10 --human
node src/cli.mjs inspect --source /work/source --entry src/core/index.js --human
node src/cli.mjs plan --source /work/source --target /work/app --entry src/core/index.js --human
```

Discovery ranks export-name matches above path matches, then source-body matches. All query terms must match the same file. Omit the query to list exported boundaries. Results include exact export locations, file hashes and an `inspect` command input for API/MCP clients. Source text is not returned.

Only JS/TS is parsed; Vue/Svelte templates, declarations, hidden/generated/dependency paths and symlinks are excluded. Scan limits are 5,000 visited entries, 512 KB per parsed file, 20 MB total and 40 directory levels. Oversized files, parser errors, exhausted budgets and omitted symlinks produce partial coverage. Result limiting is reported separately from scan completeness. A result is a lexical lead, not runtime proof; no matches does not establish absence.

CLI, the typed `executeCommand` API and MCP share these commands and validation. MCP tools are `discover_features`, `initialize_workspace` and `diagnose_environment`. The `transfer_feature` prompt accepts an optional entry or query, so a host agent can discover first. Its configured root still limits every path.

## Install a local alpha tarball

No registry package is published. A maintainer can create and verify a local package with `npm run release:clean`. In a separate empty directory, replace the tarball path with the artifact it reports:

```sh
npm init -y
npm install --ignore-scripts --omit=dev /absolute/path/portsmith-workbench-0.6.0-alpha.1.tgz
./node_modules/.bin/portsmith doctor --human
node node_modules/portsmith-workbench/scripts/demo.mjs
```

For the packaged browser demo:

```sh
node node_modules/playwright/cli.js install chromium
node node_modules/portsmith-workbench/scripts/demo-browser.mjs
```

CLI examples using `node src/cli.mjs` assume a source checkout. In an installed consumer project replace that prefix with `./node_modules/.bin/portsmith`. MCP can use the installed `node_modules/portsmith-workbench/src/mcp.mjs` absolute path. Development tests and research harnesses are source-only; `npm run check` is not a command for the installed package directory.

## Troubleshooting

- **Unsupported Node or TypeScript errors:** use Node 22.19+ or 24.11+; repo-specific build requirements can be stricter.
- **Missing Chromium executable:** run the install command above under the same account and `PLAYWRIGHT_BROWSERS_PATH` as the demo. Verification resolves that executable in the caller and passes its path to the stripped-environment runner; it does not fall back to another account's cached browser.
- **Missing Linux shared libraries:** run `npx playwright install --with-deps chromium` from the checkout before retrying.
- **No model key:** load the private `.env` with `node --env-file=...`; the authored demos never require it.
- **Run directory already exists:** select a new output directory. Reusing or changing a frozen contract is not a repair.
- **No disk space:** release tests need space for fresh dependencies, Chromium and temporary snapshots. Clean checks delete only their own temporary installations after recording their outcome; retain proof files before manually deleting old experiments.

[Release checks and benchmark boundaries](release.md).
