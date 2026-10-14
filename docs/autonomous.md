# Autonomous adaptation

Portsmith asks a model for a JSON edit proposal, applies it to a candidate, runs the frozen checks, and feeds failures back for repair. It exports only when the existing verification gates pass. It does not invent or weaken the contract, install dependencies, apply the patch to the original app, or promise general correctness.

## Setup

Create `.env` with `OPENAI_API_KEY=...`. Git and transfer snapshots exclude this file. Never paste a key into the model configuration.

```json
{
  "baseURL": "https://api.openai.com/v1",
  "model": "gpt-5.6-terra",
  "apiKeyEnv": "OPENAI_API_KEY",
  "timeoutMs": 120000,
  "maxOutputTokens": 8000,
  "maxContextBytes": 200000
}
```

The provider uses Chat Completions with strict JSON Schema, no tools and `store: false`. An OpenAI-compatible service must support those request fields. HTTPS is required except for loopback endpoints, and redirects are rejected. Model availability depends on the configured account. [Official Terra model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-terra) · [Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

After `prepare`, run:

```sh
node --env-file=.env src/cli.mjs auto-adapt --run /work/transfer-001 \
  --config portsmith.model.json --allow-model --allow-execution \
  --max-attempts 3 --timeout-ms 30000 --human
```

`--allow-model` authorizes transmission of selected candidate code, the contract and verification feedback to the configured endpoint. `.env` and excluded snapshot files are omitted, but this is not a universal secret scanner: review source before sending private repositories. Model credentials are not forwarded to repository subprocesses. The whole run remains locked during adaptation.

## Larger apps

Add `"contextFiles": ["src/utils/convert.ts", "src/tools/text-statistics/text-statistics.vue"]` to the model configuration. Paths are explicit, repository-relative candidate files. The callable target, copied feature (including declarations), root manifest and declared regression files are always included. The summary records included and omitted paths. Without this setting, all supported text files are included; Vue and Svelte are recognized. Neither mode silently drops selected content to fit a budget. Failed-command feedback includes the final 8,000 characters per stream; full logs remain in the run evidence.

## Limits and evidence

The maximum is five proposals; the default is three. Each model request has a 120-second maximum and an output-token cap. Context over the configured byte limit fails explicitly instead of truncating. Verification timeouts apply per subprocess. Usage is recorded per response; these limits are not a currency-denominated budget.

Preflight stops if source behavior, the baseline gap, baseline regressions, baseline declared checks or integrity fail. The model can edit destination code and UI files. Frozen tests, build/type-check configurations, copied feature files, notices, provenance, manifests and lockfiles are protected. The destination entry must reach the copied feature through its literal import graph; a reimplementation without that connection is rejected. This does not independently prove runtime call provenance. Every applied proposal uses current hashes; stale proposals are rejected. Previously provisioned `node_modules` survives adaptation but is excluded from evidence hashes. Its root must be a real directory, not a symlink; unsupported setup is rejected before model transmission. Internal package-manager links are allowed. Preflight diagnostics name the blocked stage and failed declared check.

Each `autonomy-*` directory contains the initial verification, applied proposals, per-attempt verification and a summary including model, endpoint, usage, status and errors. Failed attempts remain inspectable in the candidate; exhaustion never exports a new patch. Run the command again to start a new bounded session from the current candidate. A manual edit invalidates earlier verification as usual.

MCP exposes `auto_adapt_transfer` only with server `--allow-execution`. Start the server with `node --env-file=/absolute/path/.env ...`, then pass `allowExecution: true` and `allowModel: true` on the tool call. Configure a client timeout long enough for the chosen model and verification limits. CLI, MCP and API all use the same application workflow.

The live examples use GPT-5.6 Terra. Repair, malformed responses, protected edits and exhausted attempts are also tested with a local protocol test double; those tests are not evidence of model quality.

Copied feature directories are immutable, including new declaration files. When a JavaScript feature lacks TypeScript declarations, the model should place a small runtime wrapper and matching declaration in the destination outside that directory. Autonomous proposals cannot increase leading `@ts-ignore`, `@ts-nocheck` or `@ts-expect-error` directives. This is a focused quality guard, not a complete detector of every possible type-system bypass. Existing destination directives are preserved; frozen build and behavior checks still decide the result.
