# Optional Rea analysis

Portsmith can attach Rea's static application analysis and module trace to a prepared transfer. The source snapshot is hashed before and checked after the provider call. Full structured evidence is retained, including upstream identifiers, confidence/authority fields and limitations. The adapter checks envelope shape, linked application/trace IDs and a non-empty module match; it does not independently implement Rea's graph authentication algorithms.

## Setup

Install a Rea release separately, with a Node runtime it supports. The adapter never downloads or installs Rea automatically. For the tested 6.4.0 package, the supported Node ranges are `^22.19.0 || ^24.11.0 || >=26.0.0`.

Create a local configuration:

```json
{
  "command": "/absolute/path/to/supported/node",
  "args": ["/absolute/path/to/rea-agents/scripts/rea.mjs", "--mcp"]
}
```

Then:

```sh
node src/cli.mjs rea-trace --run /work/transfer-001 \
  --config /work/rea.json --allow-execution
node src/cli.mjs verify --run /work/transfer-001 --allow-execution
node src/cli.mjs export --run /work/transfer-001
```

Only the two static analysis tools are invoked. The configured executable itself must be trusted. A per-run provider home avoids reading normal Rea user configuration; PATH is retained. On macOS, the config optionally accepts explicit `env` values for `REA_DARWIN_SWIFTC_PATH`, `SDKROOT`, and `REA_DARWIN_MODULE_CACHE_PATH` to select an installed compatible compiler/SDK and writable cache. No system toolchain settings are changed.

Outputs:

- `rea-evidence.json`: full application and trace evidence.
- `rea-summary.json`: server version, source-snapshot binding, evidence IDs, payload digest, coverage, fact counts and limitations.
- `verification.json`: references the same provider summary when subsequent behavior checks run.

No match, malformed results, provider errors and mismatched references fail the operation. Changed evidence invalidates patch export. Rea's static result never satisfies the source, destination or regression behavior gates by itself. Without this optional attachment, Portsmith uses its own literal-import scanner.

## Recorded validation — 2026-10-13

- Adapter protocol tests: linked successful response, upstream failure, mismatched source reference, no matched module, changed payload, explicit process-start authorization.
- Live attempt: Rea 6.4.0 server connected under Node 24.11.1 on macOS ARM64. `analyze_javascript_application` failed during startup of its macOS process-ownership helper. The installed Swift compiler/default SDK reported a `SwiftBridging` module redefinition and incompatible SDK/compiler builds.
- Live Linux validation subsequently **passed** with the unchanged published Rea 6.4.0 package and Node 24.11.1. Both `analyze_javascript_application` and `trace_application_feature` returned real evidence through the MCP adapter, first for the table-filter fixture and then for the pinned clsx source. Both transfers were then re-verified and exported with that evidence attached.

| Source | Trace coverage | Matched seeds | Nodes | Edges |
| --- | --- | --- | --- | --- |
| Table-filter fixture | `complete-within-source` | 2 | 6 | 6 |
| clsx `src/index.js` | `complete-within-source` | 2 | 4 | 3 |

Local evidence resides in `.portsmith/demo-hqcCTE/run/rea-evidence.json` and `.portsmith/clsx-Nk3B6K/run/rea-evidence.json`; summaries and updated behavior reports sit beside them. Coverage is Rea's static graph coverage within the supplied source, not behavior equivalence or production coverage. Upstream limitations, including unavailable artifact identity, remain in the retained evidence.

The Linux test used the cached public Debian-based image `pgvector/pgvector@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b` solely as an OS base with its entrypoint replaced; no database was launched. The container ran as UID 1000, with network disabled, capabilities dropped, no new privileges, read-only filesystem/source/provider mounts and a writable temporary directory. It removed itself after completion. Public Node image downloads had stalled, so this avoided changing the Mac's compiler or unrelated containers.

Rea requires procps-compatible process inspection on Linux. Official Debian [procps](https://packages.debian.org/bookworm/arm64/procps/download) and [libproc2](https://packages.debian.org/bookworm/arm64/libproc2-0/download) 4.0.2-3 ARM64 packages were extracted into the test workspace, not installed on the host. Their SHA-256 checksums were verified against Debian's published values: `94414d947f009b55d50e2adf19d92038998bf7fa9ec553b1b6167fb02b5c1855` and `d2d31e0f862dd60a813e245024d00cf47deb6465fd42122543824652487224be` respectively. The local Docker MCP configurations are saved in `.portsmith/rea-linux-config.json` and `.portsmith/rea-linux-clsx-config.json`.

The transfer engine does not depend on Rea being available. No upstream code or system compiler installation was modified. This validates two real provider calls per source, not Rea's entire tool catalog.

## Matched real-repository comparison — 2026-10-14

The installed 6.4.0 MCP server advertised 170 tools and was run on the pinned drawDB, Mermaid Live Editor, dequal and stable-stringify trees. Whole-app results retained partial coverage; focused drawDB recovery produced a complete-within-source trace. This is new live-provider evidence, separate from protocol doubles and the earlier fixture runs. See [comparison methodology, product fixes and scoped results](comparison-rea.md).

The subsequent [multi-file search comparison](benchmark-search.md) captures additional live Rea 6.4.0 analysis of pinned Fuse and drawDB repositories. Both analyses report partial coverage; the report separates that static evidence from matched live-model transfers and supplemental browser proof.

## Virtual modules and planned package imports (2026-10-14)

The [virtual-module comparison](benchmark-virtual.md) records a new live Rea 6.4.0 evidence-assisted trial on pinned jsondiffpatch/drawDB copies, using the same model and Portsmith verification gates. Both final integrations passed; independent comment-only YAML testing required one extra repair in the Portsmith-assisted arm. These are live-provider/model results, distinct from MCP protocol doubles, and do not establish standalone Rea parity.

## Automatic setup and dual-format transfer, 2026-10-14

The [automatic setup benchmark](benchmark-packages.md) adds real locked destination installation and automatically discovered YAML/JSON5 imports to the jsondiffpatch → drawDB transfer. Portsmith and live Rea-assisted evidence each led to a first-proposal pass under the same 18-case contract, 13 destination regressions, production builds and fresh patch replay. Each also passed 500 held-out histories per format and browser save/reload checks. Rea traces retained partial coverage; this remains one evidence-assisted trial using a shared Portsmith execution judge.
