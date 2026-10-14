# Browser workflows

Add a `browser` section to the frozen function contract. Portsmith still verifies source behavior and Node regressions; Chromium checks the destination experience before and after integration.

```json
{
  "page": "index.html",
  "actionTimeoutMs": 1500,
  "cases": [{
    "name": "search products",
    "steps": [{"action": "fill", "selector": "[data-testid='query']", "value": "TEA"}],
    "assertions": [{"kind": "text", "selector": "[data-testid='products']", "expected": "Tea leaves"}]
  }],
  "regression": [{
    "name": "reset catalog",
    "steps": [
      {"action": "fill", "selector": "[data-testid='query']", "value": "TEA"},
      {"action": "click", "selector": "[data-testid='reset']"}
    ],
    "assertions": [{"kind": "count", "selector": "li", "expected": 3}]
  }]
}
```

Run `npm run browser:install` once, then `verify --allow-execution --timeout-ms 30000`. `npm run demo:browser` executes a complete authored fixture; `npm run demo:autonomous` generates its integration with the configured model.

Actions are `fill`, `click`, `press` and `check`. Assertions cover text, count, visibility and input value. Each scenario requires at least one assertion and starts in a clean browser context. Prefer stable test IDs. Playwright waits for actions and assertions; there are no arbitrary test sleeps. Assertion mismatches can establish the baseline feature gap; missing action targets, navigation failures, browser crashes and runtime errors cannot.

## Local app startup

By default, an internal loopback server serves the snapshot with symlinks, traversal and excluded paths rejected. Existing frontend apps can declare their own server:

```json
{"command":"node","args":["node_modules/vite/bin/vite.js","--host","127.0.0.1","--port","{port}","--strictPort"]}
```

Put that object in `browser.server`. `{port}` is required; Portsmith allocates a local port, waits for the configured page to respond and stops the server afterward. Provision dependencies in baseline and candidate before verification. No packages are installed automatically, and their contents are not attested. React/Vite is an example configuration, not a separately validated framework benchmark.

The browser permits requests to the current app origin, blocks service workers, external requests and WebSockets, and uses no saved login profile. Apps needing external APIs, authentication or WebSocket behavior need a future explicit policy/fixture mechanism. The configured server and Node checks still run on the host; these browser network controls do not sandbox repository code. See [Playwright network guidance](https://playwright.dev/docs/network).

## Evidence and failure handling

Each scenario records a viewport screenshot and Playwright trace under a new `browser-*` directory. The verification report records assertions, errors, browser version and artifact hashes. Export rejects changed or missing evidence. Use `npx playwright show-trace PATH.zip` to inspect a trace locally.

`actionTimeoutMs` controls actions and assertions. Screenshot capture has a separate 10-second limit so font loading and rendering do not inherit short interaction deadlines. The overall verification process deadline still applies to capture and trace finalization. Missing or timed-out evidence fails verification.

A pass requires an error-free baseline with at least one feature mismatch, passing browser regressions before and after integration, every candidate browser case passing, and all existing Node/integrity gates passing. Empty assertions, empty browser regressions, timeouts, skipped work and outdated verification versions cannot authorize export.

Current coverage is Chromium, DOM interactions and a local static/custom-server workflow. Mobile devices, other browser engines, visual-diff tolerances, authenticated sessions and broad real-app compatibility remain unverified.
