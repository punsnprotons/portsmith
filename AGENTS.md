# Working on Portsmith

Portsmith is a local prototype for transferring a source feature into a destination copy and checking a declared behavior contract. Read README.md and docs/workflow.md before changing its verification semantics.

- Keep analysis, integration and behavior claims separate. Static import tracing is not runtime proof.
- Preserve source/destination originals. Work in a fresh run directory and export a reviewable patch.
- Never weaken the frozen contract or destination tests to make an integration pass. A new contract requires a new run.
- Missing exports, exceptions, skipped checks, timeouts and unrun regressions cannot become a verified result.
- Do not run unfamiliar repository code without explicit execution authorization. Separate processes are not security sandboxes.
- Rea is an optional MCP evidence adapter. Distinguish protocol-test results from live-provider results recorded in docs/rea.md. The original demo uses an authored proposal. Autonomous demos use a configured model; distinguish live-model evidence from protocol test doubles.
- Browser and model credentials never enter snapshot inventories or exported patches. Use .env for keys, never committed configuration.
- Run npm test for engine changes. Run npm run demo when changing the transfer or export workflow.
- Keep the package private until publication is explicitly requested. Do not claim uniqueness, broad reliability or viral probability from the fixture.
