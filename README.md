# Portsmith

[![Tests](https://github.com/punsnprotons/portsmith/actions/workflows/ci.yml/badge.svg)](https://github.com/punsnprotons/portsmith/actions/workflows/ci.yml)

**Move a feature into another app. Review the patch and the checks behind it.**

Portsmith is a local CLI, MCP server and typed JavaScript API for JavaScript/TypeScript feature transfers. It copies the source feature into a destination snapshot, accepts developer or model integration edits, and verifies a frozen behavior contract before exporting a patch. Original repositories stay unchanged.

**Public alpha · `0.6.0-alpha.2`.** This is scoped verification, not a guarantee for arbitrary apps or demonstrated parity with Rea.

## Install and try it

Use Node **22.19+ or 24.11+** and Git:

```sh
npm install -g portsmith-workbench@alpha
portsmith doctor --human
portsmith-demo
```

No API key or browser is needed. The included authored proposal transfers table filtering into a catalog app: source **5/5**, destination **1/5 → 5/5**, existing regressions pass, and the exported patch reproduces the verified candidate. Output goes into a new `.portsmith/demo-*` directory in your current folder.

Try without a global install:

```sh
npx --yes --package=portsmith-workbench@alpha portsmith-demo
```

For Chromium interaction checks, download the matching browser and run the demo:

```sh
portsmith-demo --install-browser
# Later runs can reuse the download:
portsmith-demo --browser
```

On a minimal Linux host, install browser OS dependencies with `npx playwright@1.61.1 install-deps chromium`. This may require administrator privileges. [Project installation, model setup and troubleshooting](docs/setup.md).

## Transfer a feature

Discover an entry point, then inspect its code and dependencies:

```sh
portsmith discover --source /work/source --query "search" --human
portsmith inspect --source /work/source --entry src/filter.mjs --human
portsmith plan --source /work/source --target /work/app --entry src/filter.mjs --human
```

Write a [behavior contract](docs/workflow.md) that names the source/destination functions, expected cases and unchanged regression tests. Prepare a fresh run and supply an integration proposal:

```sh
portsmith prepare --source /work/source --target /work/app \
  --entry src/filter.mjs --mount src/features/filter \
  --contract /work/contract.json --out /work/transfer-001
portsmith adapt --run /work/transfer-001 --proposal /work/proposal.json
portsmith verify --run /work/transfer-001 --allow-execution
portsmith report --run /work/transfer-001 --human
portsmith export --run /work/transfer-001
```

Use trusted repositories: verification executes code on your computer, **not in a security sandbox**. Review the patch before applying it yourself. The run directory must be new, outside both repositories, with an existing parent.

## Let your model adapt it

Use an OpenAI-compatible endpoint and a model available to your account:

```sh
portsmith init --out /work/portsmith-setup --model YOUR_MODEL_ID
# Copy that directory's .env.example to .env and add your key locally.
portsmith --env /work/portsmith-setup/.env doctor \
  --config /work/portsmith-setup/portsmith.model.json --browser --human
portsmith --env /work/portsmith-setup/.env auto-adapt \
  --run /work/transfer-001 --config /work/portsmith-setup/portsmith.model.json \
  --allow-model --allow-execution --human
```

The model proposes destination edits and repairs failures within a bounded attempt limit. Frozen tests, contracts and copied feature files cannot change. `--allow-model` sends selected code to your configured provider. Keep credentials in `.env`. [Model setup and limits](docs/autonomous.md).

## Supported scope

| Capability | Alpha scope |
| --- | --- |
| Discovery | Lexical JS/TS ranking, export locations and literal import tracing |
| Dependencies | Explicit npm/pnpm setup in fresh copies, including workspaces; scripts disabled |
| Aliases | Local config, static Vite/SvelteKit mappings and explicitly captured Vite/plugin resolutions |
| New packages | Proposal import discovery and reviewed donor declarations before freezing |
| Verification | Node-callable contracts; Node tests and Vitest 0.34/4.1; declared build/type checks |
| Browser | Chromium interactions, regressions, screenshots and traces |
| Delivery | Hash-bound evidence, freshness checks and independently applied patch |

[Automatic dependency setup](docs/automatic-setup.md) · [Alias and virtual-module limits](docs/dependencies-aliases.md) · [Browser contracts](docs/browser.md).

Computed imports, general cross-framework conversion and arbitrary bundler assets remain unsupported. Unknown dependency versions require reviewed declarations. Adding imports after freezing requires new setup and a new run. Installed dependency bytes are not fully attested. A passing result proves only the declared cases and completed tests.

## Connect a coding agent

Configure your MCP host, replacing the workspace path:

```json
{
  "mcpServers": {
    "portsmith": {
      "command": "npx",
      "args": ["--yes", "--package=portsmith-workbench@0.6.0-alpha.2", "portsmith-mcp", "--root", "/absolute/workspace"]
    }
  }
}
```

There are 15 default tools and 21 with server `--allow-execution`. Execution calls also need `allowExecution: true`; model calls additionally need `allowModel: true` and a key in the server environment. All tool paths must be within the configured root. This path policy does not sandbox executed code. The `transfer_feature` prompt guides discovery through export.

## Evidence and development

Real transfers include IT-Tools, TodoMVC, drawDB and Mermaid Live Editor. The most recent [jsondiffpatch → drawDB trial](docs/benchmark-packages.md) passed frozen contracts, unchanged regressions, builds, independent patch replay and browser save/reload checks in both Portsmith and Rea-assisted arms. These are controlled trials with authored boundaries, **not a standalone Rea-agent comparison or a general success rate**.

The optional [Rea adapter](docs/rea.md) retains upstream analysis evidence separately from Portsmith's behavior checks. [Validation and benchmark index](docs/validation.md) · [Research history](docs/research.md).

To develop from source:

```sh
git clone https://github.com/punsnprotons/portsmith.git
cd portsmith
npm ci --ignore-scripts
npm run browser:install
npm run check          # Types, engine tests, generated command reference
npm run release:clean # Clean install, browser, package consumer and audit checks
```

Release checks require network access, execute included test fixtures, use fresh caches and never publish. [Alpha readiness](docs/alpha-readiness.md) · [Release checklist](docs/release.md) · [Security and legacy test dependencies](SECURITY.md).

[Command reference](docs/commands.md) · [Public API](docs/api.md) · [Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md).
