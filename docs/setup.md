# Setup and feature discovery

Use Node 22.19+ or 24.11+ and Git. Install the alpha globally:

```sh
npm install -g portsmith-workbench@alpha
portsmith doctor --human
portsmith-demo
```

Or use a project-local installation:

```sh
npm install --save-dev portsmith-workbench@alpha
npx portsmith doctor --human
npx portsmith-demo
```

For one-off use: `npx --yes --package=portsmith-workbench@alpha portsmith-demo`. The demo requires no API key. It writes only to a fresh `.portsmith` run under the current directory, including when installed globally or through npx. No install lifecycle scripts or browser downloads run automatically.

The examples below use the global `portsmith` command; use `npx portsmith` in a project-local installation. From a source checkout use `node src/cli.mjs` and `npm run demo`.

For autonomous work, `portsmith init --out /work/new-setup --model YOUR_MODEL_ID` creates a new private directory containing a model config, `.env.example`, `.gitignore` and next steps. Existing directories, files and symlinks are refused. Supply `--base-url https://your-provider/v1` for another OpenAI-compatible endpoint. Choose a model your provider supports; initialization cannot validate access.

Copy `.env.example` to `.env` and add the key locally. Load it with the explicit `--env` CLI option as below. Portsmith never automatically reads `.env` or writes keys into configuration. Do not pass a key as a CLI flag.

```sh
portsmith --env /work/new-setup/.env doctor \
  --config /work/new-setup/portsmith.model.json --target /work/app --browser --human
```

Optional doctor checks report invalid configuration, an unloaded key, missing Chromium, missing destination dependencies and multiple package-manager lockfiles. It also reports declared Node and package-manager requirements, workspace member counts and dependency directories. Member-only dependencies are detected. A present dependency directory does not prove correct versions. Browser presence does not prove it can launch. Provider authentication, Rea setup and actual execution are separate checks.

Use `portsmith-demo --install-browser` to download the matching Chromium and run the included browser demo. Use `portsmith-demo --browser` on later runs. Review each repository's scripts and lockfile before provisioning dependencies in disposable snapshots. Dependencies are deliberately not installed by doctor or init. After preparing a run, use `dependencies --run DIR` for a read-only plan and `install-deps --run DIR --allow-execution` for supported frozen npm/pnpm installs. [Dependency and alias setup](dependencies-aliases.md).

## Find an entry point

```sh
portsmith discover --source /work/source --query "search" --limit 10 --human
portsmith inspect --source /work/source --entry src/core/index.js --human
portsmith plan --source /work/source --target /work/app --entry src/core/index.js --human
```

Discovery ranks export-name matches above path matches, then source-body matches. All query terms must match the same file. Omit the query to list exported boundaries. Results include exact export locations, file hashes and an `inspect` command input for API/MCP clients. Source text is not returned.

Only JS/TS is parsed; Vue/Svelte templates, declarations, hidden/generated/dependency paths and symlinks are excluded. Scan limits are 5,000 visited entries, 512 KB per parsed file, 20 MB total and 40 directory levels. Oversized files, parser errors, exhausted budgets and omitted symlinks produce partial coverage. Result limiting is reported separately from scan completeness. A result is a lexical lead, not runtime proof; no matches does not establish absence.

CLI, the typed `executeCommand` API and MCP share these commands and validation. MCP tools are `discover_features`, `initialize_workspace` and `diagnose_environment`. The `transfer_feature` prompt accepts an optional entry or query, so a host agent can discover first. Its configured root still limits every path.

## Install a local alpha tarball

Maintainers can create and verify a local package before publication with `npm run release:clean`. In a separate empty directory, replace the tarball path with the artifact it reports:

```sh
npm init -y
npm install --ignore-scripts --omit=dev /absolute/path/portsmith-workbench-0.6.0-alpha.2.tgz
./node_modules/.bin/portsmith doctor --human
./node_modules/.bin/portsmith-demo
```

For the packaged browser demo:

```sh
./node_modules/.bin/portsmith-demo --install-browser
```

The MCP executable is `portsmith-mcp --root /absolute/workspace`; see the [README configuration](../README.md#connect-a-coding-agent). Development tests and research harnesses are source-only; `npm run check` is not a command for the installed package directory.

## Troubleshooting

- **Unsupported Node or TypeScript errors:** use Node 22.19+ or 24.11+; repo-specific build requirements can be stricter.
- **Missing Chromium executable:** run the install command above under the same account and `PLAYWRIGHT_BROWSERS_PATH` as the demo. Verification resolves that executable in the caller and passes its path to the stripped-environment runner; it does not fall back to another account's cached browser.
- **Missing Linux shared libraries:** run `npx playwright install --with-deps chromium` from the checkout before retrying.
- **No model key:** load the private `.env` with `portsmith --env FILE`; the authored demos never require it.
- **Run directory already exists:** select a new output directory. Reusing or changing a frozen contract is not a repair.
- **No disk space:** release tests need space for fresh dependencies, Chromium and temporary snapshots. Clean checks delete only their own temporary installations after recording their outcome; retain proof files before manually deleting old experiments.

[Release checks and benchmark boundaries](release.md).
