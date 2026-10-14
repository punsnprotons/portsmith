# External-source integration check: clsx

Run date: 2026-10-13. Runtime: Node v23.10.0, macOS ARM64.

| Item | Recorded result |
| --- | --- |
| Source | [lukeed/clsx](https://github.com/lukeed/clsx/tree/925494cf31bcd97d3337aacd34e659e80cae7fe2) |
| Source revision | `925494cf31bcd97d3337aacd34e659e80cae7fe2` |
| Feature | Conditional class-name strings, `src/index.js` → `clsx` |
| Destination | Owned button-model fixture, initially supporting strings only |
| Contract | 8 fixed JSON function cases |
| Source | 8/8 pass |
| Destination before | 3/8 pass, 5 mismatches |
| Destination after | 8/8 pass |
| Existing destination regressions | 2/2 pass before and after |
| License | Original MIT notice copied alongside the feature |
| Patch | Exported; `git apply --check` passed |
| Rea | Original run used the built-in scanner. Subsequent hardened run also passed with real Rea 6.4.0 Linux analysis and trace attached |

Cases cover string ordering, empty arguments, conditional object keys, nested arrays, false values, numeric tokens, mixed inputs and objects nested inside arrays. Existing tests preserve button label, tag, disabled state, default classes and string ordering.

The full source feature is small enough to review before execution. The benchmark checks the exact commit and requires a clean source checkout, including untracked files. It uses no downloaded repository install scripts or test commands: only the reviewed source module and owned destination tests are executed.

## Reproduce

```sh
git clone https://github.com/lukeed/clsx.git /tmp/clsx-review
git -C /tmp/clsx-review checkout 925494cf31bcd97d3337aacd34e659e80cae7fe2
# Inspect src/index.js and license before authorizing execution.
node scripts/benchmark-clsx.mjs --source /tmp/clsx-review --allow-execution
```

Optional: add `--rea-config /absolute/path/to/rea.json` to run real Rea analysis before adaptation. Provider failure stops that benchmark invocation; it does not silently fall back or produce a passing Rea result.

Every invocation writes a new `.portsmith/clsx-*/` directory with the contract, proposal, snapshots, per-case report, patch and result JSON. Local run used for the table: `.portsmith/clsx-74bLl0/`.

After the verification hardening, the same benchmark was repeated as `.portsmith/clsx-Nk3B6K/`, with the same 3/8 → 8/8 result and two regression tests passing. Real Rea analysis and trace were attached, then behavior verification and patch export were repeated successfully. See [provider evidence](rea.md) and [validation report](validation.md).

## Interpretation

This establishes that the pipeline can import a reviewed external source module, integrate it into a controlled destination API, preserve its license, and verify explicit behavior plus regressions. The integration proposal is authored. It does not measure autonomous adaptation, browser rendering, large dependency graphs, external destination apps, improvement over a plain coding agent or likelihood of virality. For a tiny standalone utility like clsx, installing the existing npm package is usually simpler; this run validates the mechanism, not a compelling reason to vendor that utility.
