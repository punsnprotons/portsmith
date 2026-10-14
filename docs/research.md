# Research and product decision

Source inspected on 2026-10-13. The statements below describe the inspected revisions, not guarantees about future versions or the entire competitive landscape. Neither competitor was runtime-tested for this comparison.

## What is different

| | Rea | Graft | Portsmith prototype |
| --- | --- | --- | --- |
| Main job | Investigate software and retain evidence | Extract repository features into portable bundles | Stage a feature in a destination and verify a proposed integration |
| Inputs | Source, artifacts, runtime observations, investigation requests | Source repository and requested feature | Source + destination + entry + explicit behavior contract |
| Output | Analysis, graphs, traces, evidence, verification results | Selected file slices, manifest/env/docs, ZIP | Candidate tree, scoped verification report, applyable patch |
| Interaction | CLI/MCP | Web UI + backend | CLI/MCP |
| Role of AI here | Agent workflows over analysis tools | Model-driven feature discovery and file selection | Developer/host-agent edits or configured model adaptation |

### Rea

Repository: [morluto/rea](https://github.com/morluto/rea), revision [`a8b50ea`](https://github.com/morluto/rea/tree/a8b50ea147ab3aaa2870160481e09403c3310ea0), package version 6.4.0, MIT.

- [JavaScript workflows](https://github.com/morluto/rea/blob/a8b50ea147ab3aaa2870160481e09403c3310ea0/docs/javascript-application-workflows.md) describe application/semantic graphs and `trace_application_feature`.
- [MCP contracts](https://github.com/morluto/rea/blob/a8b50ea147ab3aaa2870160481e09403c3310ea0/docs/mcp-contracts.md) distinguish evidence, provenance, confidence and limitations.
- [Reconstruction verification](https://github.com/morluto/rea/blob/a8b50ea147ab3aaa2870160481e09403c3310ea0/src/domain/reconstructionVerification.ts) already verifies declared claims and includes behavior-related comparisons. Verification alone is **not** a novel distinction from Rea.

The alignment is architectural: shared CLI/MCP core, retained file identities, explicit analysis limits and narrowly worded verification outcomes. Portsmith does not reproduce Rea's binary/runtime investigation capabilities or its full evidence schema. Its optional adapter calls `analyze_javascript_application` then `trace_application_feature`, retaining Rea evidence identifiers and limitations separately from destination checks. Protocol tests pass, and real Rea 6.4.0 analysis/trace succeeded for both the demo and clsx sources in isolated Linux. Native macOS analysis hit a host Swift/SDK mismatch; see [current provider status](rea.md).

### Existing Graft

Repository: [melvinthoompunkal/Graft](https://github.com/melvinthoompunkal/Graft), revision [`a386620`](https://github.com/melvinthoompunkal/Graft/tree/a386620842c34f1f731bf6ffc91bdb1b101f31ba), MIT.

- [Request models](https://github.com/melvinthoompunkal/Graft/blob/a386620842c34f1f731bf6ffc91bdb1b101f31ba/graft-backend/models/requests.py) contain source ingest, feature trace and bundle inputs; no destination repository input.
- [Claude service](https://github.com/melvinthoompunkal/Graft/blob/a386620842c34f1f731bf6ffc91bdb1b101f31ba/graft-backend/services/claude_service.py) uses models to discover features and select candidate files; the inspected selection is capped at 15 files.
- [Tracer service](https://github.com/melvinthoompunkal/Graft/blob/a386620842c34f1f731bf6ffc91bdb1b101f31ba/graft-backend/services/tracer_service.py) combines parsing, fallback matching and model-provided line ranges.
- [Bundle service](https://github.com/melvinthoompunkal/Graft/blob/a386620842c34f1f731bf6ffc91bdb1b101f31ba/graft-backend/services/bundle_service.py) writes selected slices, dependency metadata, environment examples, documentation and a ZIP. The reviewed path does not build/test an integration against a destination app.

This overlaps substantially with the originally suggested extraction product and the name Graft. Portsmith is a working replacement name, not a checked trademark or package-name claim.

## The bet to test

**“Take that feature, put it in my app, show me the patch and the passing checks.”**

Destination integration and its evidence are the intended value. The first prototype deliberately tests the workflow with an owned, dependency-free fixture. It has not demonstrated superiority to Graft, Rea plus a coding agent, or a plain coding agent. No search can establish that nothing similar exists, and there is no justified numerical probability of virality.

## Next benchmark, before broader claims

Use ten independent transfers from permissively licensed repositories into existing apps. Start with Node-callable TypeScript/JavaScript behavior; include browser interaction contracts using the Chromium runner. Include text filtering, pagination, sorting, validation and formatting across varied project layouts.

For each task, freeze expectations and regressions before either method starts. Compare the same coding model, source/destination revisions, time/token budget and tool permissions with versus without Portsmith. Use independent review and more than one run where feasible.

Record: successful user-visible outcomes, regressions, manual fixes, time to reviewed patch, changed files, false passes and total model/tool cost. Include every failure; do not select only working demos. Report scoped results with confidence intervals only once there are enough observations.

Current evidence includes controlled transfers into IT-Tools, TodoMVC, drawDB and Mermaid Live Editor, live model integrations, Chromium checks and paired Rea-assisted trials. See the [validation index](validation.md) for scope and historical results. The proposed representative ten-task benchmark remains **not run**. Source is available as a [public alpha](https://github.com/punsnprotons/portsmith); the npm package remains unpublished.
