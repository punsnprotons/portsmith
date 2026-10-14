# Dependency and alias setup

## Install into copied repositories

After reviewing the source/destination code and preparing a run:

```sh
portsmith dependencies --run /work/run --human
portsmith install-deps --run /work/run --allow-execution --human
portsmith verify --run /work/run --allow-execution --timeout-ms 120000
```

`dependencies` performs no installation. It checks each copied side for one supported lockfile, package-manager declaration and unsupported inputs. Source dependencies are needed only when the traced feature imports external packages; destination development dependencies are included for tests/builds.

The installer supports npm `package-lock.json` versions 2/3 and pnpm `pnpm-lock.yaml`. It runs the existing manager, refuses a mismatch with an exact `packageManager` declaration, enforces Node engine requirements, disables lifecycle scripts, isolates user/global config, and installs in staging before replacing each copied `node_modules`. It neither downloads package managers nor changes originals. Use `--manager-bin /absolute/path/to/npm` or the pnpm executable when it is not on PATH; the selected executable must match the planned manager. Runs requiring different managers should use their executables on PATH. `--offline` requires the run's package cache to have the packages already. `--timeout-ms` is capped at 120000 ms per install.

Npm workspaces and explicitly declared pnpm workspaces are supported: simple directory patterns, local member links, and pnpm catalogs. All member manifests and the workspace configuration are hashed. Staged installs publish root and member dependency directories together, and adaptation preserves their relative links. Limits: 100 members, no nested workspace declarations, injected packages or unsupported pnpm settings. Patched/local-file/Git dependencies, direct tarball resolutions, private registry authentication, Yarn and Bun need manual provisioning. Public npm registry lockfile URLs are supported; user registry credentials are not forwarded. Scripts requiring native compilation or framework generation are not enabled automatically. Declare necessary build/type checks and run them explicitly. Successful installation alone never proves runtime readiness.

If setup fails, the failing side's previous dependency directory is retained. Earlier sides may already be installed. The run remains incomplete until a successful setup finishes. Receipts record input hashes, manager versions, exit status, timing and output hashes; raw registry logs are not persisted. Known failure codes help identify engine, lockfile, offline-cache and network errors without exposing arbitrary registry output.

Installing again makes previous verification stale. Re-verify before exporting. Receipts attest inputs and completion, **not every installed dependency byte**. Manually provisioned runs without receipts remain supported and carry no installer attestation. Processes are not security sandboxes.

## Resolve local aliases

Use an existing root `tsconfig.json`/`jsconfig.json`, supported static framework configuration, or an explicit `portsmith.aliases.json`. Configuration code never executes during analysis:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@app/*": ["src/*"],
      "@search": ["lib/search.ts"]
    }
  }
}
```

```sh
portsmith inspect --source /work/source --entry src/index.ts --aliases --human
portsmith plan --source /work/source --target /work/app --entry src/index.ts --aliases --human
```

Freeze `"runtime": { "aliases": true }` in the behavior contract before `prepare`. It selects verification version 9 and enables the local alias/relative-import loader for callable checks and Node regression tests. Preparation validates both configurations. Exact matches take priority over wildcard prefixes. Local `extends` and JSONC comments are supported; package `extends` without explicit local `paths` and `baseUrl`, fallback arrays, multiple wildcards, implicit baseUrl package lookup and CommonJS aliases are not.

Source alias imports become relative imports in the copied feature. This prevents a source `@app/*` from accidentally using the destination's unrelated mapping. The source originals stay unchanged; rewrites are visible in `plan`, provenance and the patch. All copied feature files remain immutable during adaptation and verification. Destination alias configuration is frozen independently and supplied to the autonomous model.

Static **Vite `resolve.alias` objects** and **SvelteKit 2 `kit.alias` / `$lib` / `kit.files.lib`** are read automatically when aliases are enabled. Literal paths, imported `path.resolve`, and `fileURLToPath(new URL(..., import.meta.url))` are supported. SvelteKit's generated tsconfig need not exist for alias analysis. Framework and TypeScript mappings must agree; an explicit `portsmith.aliases.json` takes precedence. Dynamic configs, regex/array aliases, config mutation, CommonJS config exports, plugin-provided aliases, package-config inference and SvelteKit 3 need an explicit map. This bounded syntax reader does not evaluate arbitrary JavaScript behavior.

For non-erasable TypeScript such as enums, freeze `"runtime": { "aliases": true, "transformTypes": true }` before preparing a new run. The transform uses version 8 on its own, or version 9 with aliases, and enables Node's `--experimental-transform-types` for callable checks and Node regressions. Use a Node release supporting that flag (tested on 22.19.0, 23.10.0 and 24.16.0); browser/Vitest builds still use their own transformers. Other build/check commands must declare their own runtime flags.

This does not configure Vite, webpack or a framework for you. Configure those mappings before preparing the run and declare a real build check. TypeScript's [`paths` setting](https://www.typescriptlang.org/tsconfig/paths.html) does not rewrite emitted imports. Browser builds and Node contract checks must both pass.

## Current evidence

Installer protocol tests cover failure, timeout, version mismatch, lock drift, stale verification and secret-free receipts. Separate real installs use npm 11.6.2 and pnpm 10.34.6, load an actual dependency, and verify a lifecycle canary never runs. Full drawDB locked npm installs and production builds are also tested. [Complex transfer comparison](benchmark-index.md) records the live MiniSearch/Rea comparison and its limits.

Workspace installation and the Zod-to-Mermaid comparison are detailed in [the workspace benchmark](benchmark-workspace.md). A package-manager checksum suffix is accepted as metadata; Portsmith checks the executable version, not its binary integrity.


## Dynamic Vite and plugin aliases

After reviewing a repository and installing its dependencies in a copy:

```sh
portsmith capture-aliases --source /work/repo --out /work/repo-resolved --allow-execution --human
portsmith inspect --source /work/repo-resolved --entry src/feature.ts --aliases --human
```

Use the returned copy as the source or destination. Set `runtime.aliases: true` and declare the actual destination production build in `checks` before `prepare`. The new command is also available as MCP `capture_framework_aliases` and through `executeCommand('capture-aliases', ...)`. Both the MCP server and the individual request must authorize execution.

The capture runs Vite's **build** pipeline with an empty entry, then asks its resolver about existing literal imports with their actual importer paths. Async config callbacks, regex aliases, plugin `config` hooks, and `resolveId` hooks initialized in `buildStart` can resolve to local files. It records observations in `portsmith.resolved-aliases.json`; read-only analysis and Node checks consume that data without loading the configuration again. Source alias imports become portable relative imports at extraction. Destination observations remain specific to each importer.

`--mode production` is the default. `.env` files and inherited model/browser credentials are excluded; environment-dependent configurations must be made reproducible in the reviewed copy. Dependencies and relative workspace links are copied, never linked to an original repository. Captured config dependencies, available build watch files, and JSON/JSONC/YAML inputs are hash-bound; changed inputs require a fresh capture and run. Frozen receipts and configuration cannot be edited to repair a failed transfer. Captured alias metadata enters model context; bound data-file contents are included only when explicitly selected, avoiding large unrelated context payloads.

**Boundaries:** captures record literal JS/TS import pairs in one build mode. New bare importers need a matching existing or planned observation. Plugin rewrites of ordinary relative imports, Vue/Svelte template imports, assets, outside paths and CommonJS alias execution remain unsupported. Some plugins need a complete application graph. Unresolved observations outside the selected feature are reported; unresolved imports within its closure block preparation. External source dependencies still need identical declared ranges in source and destination.

### Virtual modules and new package imports

Enable portable generated ESM explicitly:

```sh
portsmith capture-aliases --source /work/source --out /work/source-resolved --virtual-modules --allow-execution
```

For literal `virtual:*` imports resolved to internal NUL-prefixed IDs, Portsmith loads the real plugin graph after build initialization, captures transformed JavaScript and writes hash-bound `portsmith-virtual/*.mjs` files into the new copy. Nested virtual modules, cycles, local code dependencies and package imports are traced. Local/generated imports become relative imports. Package implementations are not bundled. Generated bytes, configuration and provenance remain immutable during adaptation. This follows the [Vite plugin convention](https://vite.dev/guide/api-plugin) and [Rollup load/transform API](https://rollupjs.org/plugin-development/#this-load); Vite 8 is exercised separately because its loader differs.

Limits: 100 generated modules, 500 KB per module and 2 MB combined code. Computed imports, `import.meta` (including emitted asset references), CommonJS/eval, assets and unresolved/escaping dependencies fail capture. Browser-specific APIs still need actual browser checks; a generated file alone is not runtime proof. The generated directory is reserved, so capture never overwrites an existing one.

To introduce a package import from a new or existing integration file, prepare its dependency in a reviewed destination copy first. Write a small JSON file listing **exact future import pairs**:

```json
[{"importer":"src/utils/history.js","specifier":"yaml"}]
```

```sh
portsmith capture-aliases --source /work/target --out /work/target-resolved --imports /work/imports.json --allow-execution
```

The actual plugins resolve each planned pair, even if the importer is not created yet. Unresolved and undeclared external packages fail capture. This supports new integration imports without a blanket native-resolution fallback; unplanned importers still fail explicitly. For bare imports inside transplanted files, list their final mounted importer paths too. `--imports` does not install packages: update the manifest/lock and install in a reviewed copy **before** capture and preparation. Frozen manifests, tests and contracts never change during adaptation.

Both features require a **new** frozen contract with `"runtime": {"aliases":true,"capturedImports":true}` and real production build checks. These runs use verification version **10** and reject version 9 proof. Existing alias-only contracts remain version 9. Model context exposes the planned pairs and generated-file provenance. There is no automatic recapture while an integration is being repaired.


The capture does not prove the full application build, freeze every installed dependency byte, or discover arbitrary external file reads, clocks or network dependencies inside plugins. Declare real build checks and behavior cases; captures are valid only for reviewed reproducible configuration. A separate process is not a security sandbox. Logs are hashed rather than retained because configuration can print credentials.

Live Vite 4.5.14, 8.0.3 and 8.1.0, `vite-tsconfig-paths` 6.1.1, and the jsondiffpatch/drawDB comparison are recorded in [the dynamic-alias benchmark](benchmark-dynamic.md).

For new packages before freezing, [automatic setup](automatic-setup.md) combines proposal import discovery, owner-aware npm/pnpm installation and optional Vite capture in a fresh copy. This is separate from `install-deps`, whose existing frozen locks remain immutable.
