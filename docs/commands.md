# Command reference

Generated from `src/contracts/commands.mjs`. Run `npm run docs:generate` after changing public contracts.

| CLI | MCP tool | Effect | Description |
| --- | --- | --- | --- |
| `discover-imports` | `discover_package_imports` | read | Discover literal package imports and missing declarations from repository code or proposed JS/TS edits without applying them. |
| `setup-deps` | `setup_repository_dependencies` | execute | Discover imports, add reviewed donor declarations, resolve and install locked dependencies in a fresh copy before prepare; optionally capture Vite imports. |
| `capture-aliases` | `capture_framework_aliases` | execute | Capture Vite/plugin resolutions, optional virtual ESM and planned package imports in a fresh dependency-equipped copy. |
| `auto-adapt` | `auto_adapt_transfer` | execute | Generate integration proposals using a configured model, verify and repair within bounded attempts, then export only on success. |
| `discover` | `discover_features` | read | Find ranked JS/TS entry points by export name, path and source terms without executing repository code. |
| `init` | `initialize_workspace` | write | Create a new private setup directory with model configuration and an environment template. Never overwrites an existing directory. |
| `inspect` | `inspect_feature` | read | Inspect literal JS/TS imports and export syntax without executing code. An optional destination enables dependency comparison. |
| `plan` | `plan_transfer` | read | Inspect destination conventions and produce a file mapping, blockers and integration checklist before preparing a transfer. |
| `prepare` | `prepare_transfer` | write | Create source, baseline and candidate copies with a frozen behavior contract. Does not execute repository code. |
| `adapt` | `adapt_transfer` | write | Apply a hash-checked integration proposal to a candidate copy. Keeps original repositories unchanged. |
| `verify` | `verify_transfer` | execute | Execute trusted repository behavior and Node regression tests; retain scoped evidence. Requires explicit execution authorization. |
| `export` | `export_transfer` | write | Export a patch only after current behavior and regression checks pass. Checks applyability without editing the original app. |
| `status` | `inspect_transfer` | read | Inspect candidate hashes, analysis, integrity and verification freshness without executing repository code. |
| `report` | `transfer_report` | read | Read a concise report of checked behavior, regressions, upstream analysis and remaining blockers. |
| `rea-trace` | `trace_with_rea` | execute | Start an explicitly configured Rea MCP provider and retain its application analysis and module trace. |
| `dependencies` | `plan_dependencies` | read | Preview locked dependency setup for copied source, baseline and candidate. |
| `install-deps` | `install_dependencies` | execute | Install locked dependencies in copied repositories with lifecycle scripts disabled. Invalidates prior verification. |
| `doctor` | `diagnose_environment` | read | Check prerequisites and optional model, browser and destination readiness without installing software or executing repository code. |
| `capabilities` | `list_capabilities` | read | List commands, schemas, effects, execution policy and supported providers. |
| `schema` | `get_command_schema` | read | Return the JSON Schema for a command, behavior contract or integration proposal. |
| `validate` | `validate_transfer_contract` | read | Validate a behavior contract without executing code. |

Inspect exact inputs with `portsmith schema --command NAME`; `contract` and `proposal` schemas are also available.

Execution commands require explicit authorization. MCP hides them unless the server starts with `--allow-execution`; each call must also set `allowExecution: true`.
