# Security and execution scope

Portsmith is a public alpha. Analyze and execute only repositories you trust. Execution flags authorize host processes; neither copied directories nor the MCP workspace root are a sandbox. Source code can access the host and network. Run untrusted experiments in an independently isolated environment.

Model adaptation sends selected code to the configured provider. Review that code for secrets first. Use private `.env` files for keys. Snapshot exclusions and release credential-pattern checks reduce accidental inclusion; they are not comprehensive secret detection. Never post keys, private code or unredacted run artifacts in a public issue.

## Dependency audit policy

`npm run audit:release` queries npm's advisory service and fails if it is unavailable, any production advisory exists, or an unreviewed development advisory appears. The runtime YAML dependency was updated from 2.8.1 to 2.9.1 during alpha preparation to address [GHSA-48c2-rrv3-qjmp](https://github.com/advisories/GHSA-48c2-rrv3-qjmp). Runtime dependencies are installed without lifecycle scripts in clean release checks.

The development-only `vitest@0.34.0` fixture intentionally tests the legacy regression adapter. Its Vite 4, vite-node, esbuild and tinypool dependencies have known advisories, including critical advisories. `scripts/audit-dependencies.mjs` records the exact reviewed advisory IDs and verifies that every affected installation is dev-only. This is an explicit exception, **not a claim that all development dependencies are vulnerability-free**.

These legacy packages execute only authored compatibility tests with explicit files in run mode; Portsmith does not start their UI, watch or network server. Do not use the compatibility dependencies to serve untrusted applications. They are excluded by `npm install --omit=dev` for consumers. Keep the legacy tests until support is deliberately retired; upgrading the fixture to a different major would stop testing the promised adapter. Reassess these exceptions before a stable release and whenever advisory data changes.

## Reporting

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/punsnprotons/portsmith/security/advisories/new). This channel is enabled for the repository. Include the affected version, a minimal reproduction and expected impact; omit credentials and private repository contents. Use [public issues](https://github.com/punsnprotons/portsmith/issues) only for non-sensitive bugs and feature requests.
