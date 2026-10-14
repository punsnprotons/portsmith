# Alpha readiness — 2026-10-14

**Public source alpha: `portsmith-workbench@0.6.0-alpha.1`. npm remains unpublished.** The transfer engine is ready for scoped alpha evaluation, with the documented limitations below. Repository identity and private reporting are configured. Check hosted CI for the exact pushed revision.

## Validated candidate

| Check | macOS ARM64 / Node 22.19.0 | Linux ARM64 / Node 24.11.1 |
| --- | --- | --- |
| Fresh npm install, scripts disabled | Pass | Pass |
| Fresh Chromium download and actual interaction checks | Pass | Pass |
| Engine tests | 149 passed; 0 failed/skipped | 149 passed; 0 failed/skipped |
| API types and generated command reference | Pass | Pass |
| Authored transfer and browser demos | Pass | Pass |
| Installed CLI/API, discovery and model-workspace initialization | Pass | Pass |
| Installed Node/browser demos | Pass | Pass |
| Runtime dependency audit, source lock and consumer install | 0 findings | 0 findings |
| Package/source file inventories and archive replay | Pass | Pass |

The Linux run used only an allowlisted source archive in a disposable Debian container, not the Mac's node_modules, credentials or browser cache. It is local container evidence, **not hosted GitHub CI or Linux x86-64 validation**. These release checks use authored fixtures and model protocol doubles; no new live-model/Rea comparison is claimed here. Historical real-app comparisons remain separately documented in [validation](validation.md).

## Fixes from the release pass

- Chromium verification now resolves the caller's executable before entering the stripped-environment subprocess. A custom cache could previously be ignored, causing clean Linux failure while a cached Mac browser hid the problem. A new regression refuses fallback when the configured cache is missing.
- YAML updated to 2.9.1 for the runtime advisory. Five advisory findings remain in development-only legacy Vitest compatibility dependencies; see the exact scope and exceptions in [SECURITY.md](../SECURITY.md). They are not installed for consumers.
- The consumer tarball excludes historical benchmark machinery. Source-only research scripts and their non-portable prerequisites are clearly marked.
- Setup, current limitations, benchmark indexing, alpha changelog and declared dependency licenses are documented. Private paths were removed from public benchmark reports.
- Release preparation checks private/generated paths and credential patterns, compares installed bytes, audits actual consumer dependencies and strips macOS extended attributes from source archives. A separate scan found no configured local .env values in the release inventory; that is not a universal secret/security audit.
- The release checker now creates temporary installations outside the checkout and rejects ancestor node_modules directories. Its final proof records this isolation; logs and tarballs stay under `.portsmith/alpha-release-*`. This also prevents existing project dependencies from masking missing declarations.

Earlier failed Linux/browser and sandbox-restricted Node runs are retained locally; they are not counted as successful validation. All contract and regression assertions remain intact.

## Evidence and reproduction

Run `npm run release:clean` from source. Every run records its own current inventory, runtime/platform, completed steps, artifact SHA-256 values and audit output. A passed proof is valid only for those recorded bytes. See [release instructions](release.md) for clean caches, Linux system libraries and cleanup behavior.

Recorded full runs for the table above:

- macOS: `.portsmith/alpha-release-JLmEPN/proof.json`.
- Linux: `.portsmith/alpha-linux-results/alpha-release-N7XFqc/proof.json`.
- Outside-checkout final full run: macOS ARM64 / Node 24.11.1, **149 passed**, `.portsmith/alpha-release-8bQ6Gu/proof.json`.
- Outside-checkout Linux package/audit/archive checks: `.portsmith/alpha-linux-results/alpha-release-CBlRVi/proof.json`.
- Linux test image: `sha256:8a177b7700026d1a35ace12b9ff86b59109681fe60e11c4763e21f6042867663`.

These are private local evidence references, not public downloads. Later packaging/documentation passes get new proof directories; compare their source inventory before distributing any archive.

## Public source and package status

- Source repository: [punsnprotons/portsmith](https://github.com/punsnprotons/portsmith). Repository/support metadata are configured and private vulnerability reporting is enabled.
- Hosted checks: [Node 22/24 on Ubuntu/macOS](https://github.com/punsnprotons/portsmith/actions/workflows/ci.yml). Inspect the exact commit and all four matrix jobs; local results above are separate evidence.
- No npm package or GitHub release is published. `private: true` stays in place. An npm release requires a fresh name-availability check and explicit authorization.

This is an alpha with trusted host execution, bounded JS/TS support, Chromium-only browser checks and authored behavior contracts. It does not claim production readiness, a broad autonomous success rate, uniqueness or Rea parity.
