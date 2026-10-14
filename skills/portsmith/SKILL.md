---
name: portsmith
description: Transfer a JavaScript or TypeScript feature between repositories with Portsmith, a frozen behavior contract, completed regression checks and a reviewable patch. Use when the user wants feature integration or verification through Portsmith.
---

# Portsmith

Use the installed CLI or connected Portsmith MCP tools. If neither is available, explain the setup needed using the [agent guide](https://github.com/punsnprotons/portsmith/blob/main/docs/agents.md); do not alter the user's agent settings implicitly.

Discover and inspect a source entry, then plan its destination integration. Static tracing identifies files and dependencies; it does not prove behavior. Name the source/destination callable boundaries, expected cases and supported regression command before preparation. Include browser interactions when the requested outcome depends on UI behavior.

Complete dependency and alias setup before freezing a fresh run. Work in snapshots and preserve both originals. Integration edits must not weaken the contract, destination tests, protected configuration or copied feature. Changed dependencies or expectations require a new run.

Execute only within the user's existing authorization for repository code. An MCP root restriction and a separate process are not security sandboxes. Model calls need separate authorization to send selected code to the configured provider. Credentials belong in private environment variables, not proposals or reports.

Verify the source passes, the unchanged destination has a demonstrated behavior gap, the candidate passes, and all required regressions and checks complete. Exceptions, skipped checks, timeouts and missing exports cannot become a verified result. Correct integration failures within scope; stop and explain an unsupported boundary rather than changing the tests to force a pass.

Export only fresh verified evidence. Report the patch path, declared checks, remaining limits and whether adaptation was authored, host-agent-generated or performed by Portsmith's configured model. Review the patch; do not apply it to the original destination without authorization.

Read the [workflow](https://github.com/punsnprotons/portsmith/blob/main/docs/workflow.md) for contracts and gates, [setup guide](https://github.com/punsnprotons/portsmith/blob/main/docs/setup.md) for environment problems, and [dependency guide](https://github.com/punsnprotons/portsmith/blob/main/docs/automatic-setup.md) for package changes.
