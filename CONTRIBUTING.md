# Contributing

Use Node.js 22.19+ (22.x) or 24.11+ and Git. From the source checkout:

```sh
npm ci --ignore-scripts
npm run browser:install
npm run check
npm run demo
npm run release:clean
```

`check` validates public API types, runs the test suite and checks generated command documentation. The demo completes a transfer and verifies the exported patch using included, authored fixtures. CI is configured for Node 22 and 24 on Linux and macOS; local results are recorded in [the validation report](docs/validation.md).

Read [the architecture](docs/architecture.md) and [verification semantics](docs/workflow.md) before changing workflows. Add public commands in `src/contracts/commands.mjs`, dispatch them in `src/application/service.mjs`, and update `src/index.d.ts`. Keep adapter-specific presentation out of providers. Run `npm run docs:generate` after changing command contracts.

Tests should exercise observable outcomes: apply an exported patch, reject stale evidence, preserve originals, or complete a real MCP round trip. Never relax a frozen contract or existing destination test to make a transfer pass. Browser tests launch real Chromium and loopback servers. Autonomous protocol tests use a local model test double without an API key; `npm run demo:autonomous` is the separate live-model check. Provider test doubles establish protocol handling only; record live-provider evidence separately.

Registry publication requires explicit maintainer approval; checks never publish. Local `npm pack --ignore-scripts` supports installation checks without publishing. Do not include `.portsmith` runs, downloaded providers or private repository contents in the package.

Release preparation uses an explicit source allowlist and fresh caches; see [release instructions](docs/release.md). Historical benchmark scripts are source-only experiments, not supported clean-install commands. Read [the advisory policy](SECURITY.md) before changing legacy runner fixtures.
