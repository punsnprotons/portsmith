# Use Portsmith with a coding agent

Portsmith's MCP server gives an agent the same workflow as the CLI. A connected coding agent can author proposals itself; a separate Portsmith model key is only needed for Portsmith's `auto_adapt_transfer` tool.

## Connect an MCP host

Requirements: supported Node, Git and a workspace directory containing every source, target, config and output path you want the server to access. Replace `/absolute/workspace` below. Merge the entry into your existing configuration rather than replacing other servers.

```json
{
  "mcpServers": {
    "portsmith": {
      "command": "npx",
      "args": [
        "--yes",
        "--package=portsmith-workbench@0.6.0-alpha.2",
        "portsmith-mcp",
        "--root",
        "/absolute/workspace"
      ]
    }
  }
}
```

This pins the tested published alpha. The server uses stdio, so a terminal launched directly may appear to wait silently; connect it through an MCP client. The root path must exist. It limits accepted tool paths, but does not sandbox code execution.

- **Cursor:** merge this into your project's `.cursor/mcp.json`, then enable Portsmith in MCP settings. [Official instructions](https://cursor.com/docs/mcp).
- **Claude Code:** use a project `.mcp.json` with the same structure, then approve that server in Claude Code. [Official MCP setup and scopes](https://code.claude.com/docs/en/mcp).
- **Other MCP hosts:** configure a local stdio server using the command and arguments above; follow the host's configuration format.

## Start with discovery

The default server exposes 15 tools, including discovery, inspection, planning, preparation and reports. It cannot run verification or model adaptation. Try:

> Use Portsmith to discover search-related exports in `/absolute/workspace/source`. Inspect the strongest candidate and plan a transfer into `/absolute/workspace/app`. Explain the dependencies, destination integration point and proposed behavior contract before executing code.

This is a request for a plan, not proof of a working integration. The server also exposes a `transfer_feature` prompt that guides discovery through export; hosts differ in how they present prompts.

## Enable a full transfer

For repositories you trust and authorize for execution, add `"--allow-execution"` after the workspace path in `args`, then restart the MCP server. That exposes 21 tools. Execution calls still require `allowExecution: true`; model calls also require `allowModel: true` and a key in the server environment.

> Transfer the selected feature using the agreed contract. You may execute these trusted repositories and their existing tests. Work in fresh copies, preserve the original tests and frozen contract, and export a reviewable patch only after all required checks pass. Report failures and unrun checks explicitly. Do not apply the patch to my original app.

Use the CLI's [private environment setup](setup.md) for secrets. MCP hosts inherit credentials differently; configure private environment variables through your host, never commit a key to `.mcp.json` or `.cursor/mcp.json`. The MCP binary does not load `.env` automatically.

## Optional agent workflow skill

The repository includes [skills/portsmith/SKILL.md](../skills/portsmith/SKILL.md). Copy that folder into your agent's supported project skill directory, or point the agent at the file. It covers contract boundaries, dependency setup and honest verification reporting. It does not install or enable the MCP server.

## If the agent gets stuck

| Symptom | Next step |
| --- | --- |
| `portsmith-mcp: command not found` inside the Portsmith source checkout | npm may select the checkout itself. For source development, use `"command": "node"` and `"args": ["/absolute/portsmith/src/mcp.mjs", "--root", "/absolute/workspace"]` instead |
| No tools appear | Confirm Node is supported and `npx` is on the host application's PATH; restart the server |
| Path rejected | Keep source, target, run and configuration paths under the configured root |
| Verification tool missing | Add the startup execution flag only for code you authorize |
| Model key missing | Supply the configured key variable in the server environment; do not paste it into chat |
| Export blocked | Read `report`; fix the integration and reverify, or prepare a new run when setup/contract changes |

[Command reference](commands.md) · [First transfer](first-transfer.md) · [Verification rules](workflow.md)
