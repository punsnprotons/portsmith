# Public API

The private package can be installed from a local tarball. It is not available through a published release. In this source checkout, import from `./src/index.mjs`; after installing the tarball, use the package name:

```js
import { executeCommand, commandResult } from 'portsmith-workbench';

const plan = await executeCommand('plan', {
  source: '/work/source', target: '/work/app', entry: 'src/filter.mjs'
}, { root: '/work' });
console.log(plan.files, plan.blockers);

// Only after reviewing and authorizing the code being executed:
const reply = await commandResult('verify', {
  run: '/work/transfer-001', allowExecution: true
}, { root: '/work', allowExecution: true });
if (!reply.ok) console.error(reply.error.code, reply.error.remediation);
else console.log(reply.result.status);
```

The dispatcher validates strict inputs and applies the optional workspace policy. `executeCommand` throws; `commandResult` returns `{ ok, operation, result }` or `{ ok, operation, error }`. A successful dispatch does not imply successful verification: inspect `result.status`. TypeScript declarations provide command-specific inputs and outputs; JavaScript callers receive the same runtime validation.

Lower-level exports (`analyze`, `planTransfer`, `prepare`, `adapt`, `verify`, `exportPatch`, `status`) are available to trusted local integrations. They do not apply the dispatcher's workspace-root policy. Direct `verify` still requires explicit execution authorization. Prefer the dispatcher when exposing operations to agents.

## Discovery and errors

`analyze()` and `planTransfer()` include `exports`: source path, exact line/column, ESM/CommonJS syntax, type-only status, re-export source and a conservative function-syntax hint. This supports boundary discovery; it does not replace executing the declared export.

`capabilities()` lists operations and execution availability. `schemaFor('contract')`, `schemaFor('proposal')` and `schemaFor('prepare')` return JSON Schema. The CLI equivalents are listed in [commands.md](commands.md).

Diagnostics include `code`, `message`, `remediation`, `details` and `retryable`. Common codes include `invalid_input`, `outside_workspace`, `execution_not_authorized`, `run_busy`, `snapshot_changed`, `verification_required` and `verification_stale`. Unclassified errors preserve their message under `operation_failed`.

CLI commands return exit 1 for errors, blocked analysis/plans, an unready environment or incomplete verification. Successful JSON output is the result object; failures are `{ "error": { ... } }` on stderr. MCP returns structured successful results and diagnostic error text with `isError: true`.
