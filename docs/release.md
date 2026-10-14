# Alpha release preparation

The prepared identity is **Portsmith / `portsmith-workbench` / `0.6.0-alpha.2`**. Source is hosted at [punsnprotons/portsmith](https://github.com/punsnprotons/portsmith). The npm name is not a registry reservation or trademark claim. Publication is explicitly authorized for this alpha. `publishConfig` selects the public npm registry and `alpha` tag. CI does not publish automatically.

The [readiness report](alpha-readiness.md) separates completed local checks from hosted CI and publication prerequisites.

## Repeatable local checks

Use Node 22.19+ or 24.11+, Git and network access:

```sh
npm ci --ignore-scripts
npm run browser:install
npm run check
npm run demo
npm run release:clean
```

`release:clean` copies an explicit source allowlist to a temporary workspace outside the checkout, rejects ancestor dependency directories, and saves evidence in a new `.portsmith/alpha-release-*` directory. It uses a fresh HOME, npm cache and Chromium download, without provider credentials or existing node_modules. It runs `npm ci --ignore-scripts`, all engine/type/docs checks, authored Node/Chromium demos, the advisory policy, and an installed tarball's CLI/API/discovery/setup/demo checks. It creates a source archive and package tarball, records SHA-256 inventories and step logs, and checks that source files stayed unchanged. Temporary installations are removed; archives and proof remain. No API key, live model, Rea installation or cached benchmark checkout is needed.

On Linux install Chromium's OS dependencies first (`npx playwright install --with-deps chromium`). The clean check downloads its own browser unless `PLAYWRIGHT_BROWSERS_PATH` explicitly selects an existing browser installation; such a run is not a fresh-browser-install check.

`release:check` performs packaging, consumer installation and advisory checks without the full source suite or browser checks. It is not a substitute for `release:clean`. A failed/incomplete step never produces a passed proof. Both commands access the npm registry. All generated artifacts remain private under `.portsmith`.

The CI matrix is configured for Node 22/24 on Ubuntu/macOS. It runs tests, browser demos, audits and package consumer checks, and uploads local evidence with `actions/upload-artifact`; it never publishes a GitHub release or npm package. Check the [hosted workflow runs](https://github.com/punsnprotons/portsmith/actions/workflows/ci.yml) for the exact commit being evaluated; a configured workflow alone is not passing CI evidence. Local Linux container results must be labeled separately from hosted CI.

## Publishing the npm alpha

- Repository, issue and homepage metadata point to `punsnprotons/portsmith`. Confirm npm package-name availability again before any registry release.
- Private vulnerability reporting is enabled; `SECURITY.md` links to the reporting channel.
- Review the source archive and prepared local commit, then run the hosted matrix. No remote, push, tag or release is created by the preparation scripts.
- Review the scoped alpha limitations and documented legacy test-dependency exceptions.
- After successful clean checks and hosted CI, publish the exact reviewed tarball with `npm publish /absolute/path/portsmith-workbench-0.6.0-alpha.2.tgz --tag alpha --access public --ignore-scripts --registry=https://registry.npmjs.org/`. Authenticate locally with `npm login`; never put npm tokens in this repository.
- Run `npm run release:published` afterward. It installs the exact version anonymously from npm with fresh caches, compares the registry integrity and installed bytes to the reviewed package, and tests CLI/API, discovery, initialization, MCP, demos, npx and a temporary global prefix. It never publishes. A failed post-publication check remains a failure; fixes need a new version.
- `npm install -g portsmith-workbench@alpha` and `npx --yes --package=portsmith-workbench@alpha portsmith-demo` select the alpha explicitly. The prerelease is not promoted to `latest`.

## Historical benchmark reproduction

The included authored demos and release checks are self-contained. The older `scripts/benchmark-*`, `setup-*`, `prove-*`, `browser-*`, `holdout-*`, `replay-*`, `repair-*`, `refresh-*`, `report-*` and package-manager experiment scripts are **source-only research harnesses**. Some require private `.portsmith` artifacts, downloaded providers, specific upstream checkouts or old local paths. They are not supported clean-install commands and are excluded from the consumer tarball. No benchmark npm aliases are exposed as working consumer commands.

Reports describe measured historical trials and pinned revisions, not a downloadable turnkey benchmark suite. Their raw evidence paths refer to private local archives and are not public attachments. A portable public benchmark harness remains future work; it is not required to run the alpha's fixture demos or transfer engine. Do not upload entire `.portsmith` directories as release assets.
