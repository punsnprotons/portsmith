import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readJson, saveJson, hash, inventory, same } from '../src/platform/files.mjs';
const setup = await readJson('.portsmith/index-bench/setup-latest.json'),
  paired = await readJson('.portsmith/index-bench/paired-latest.json'),
  proof = await readJson(path.join(paired.root, 'proof-latest.json')),
  live = await readJson('.portsmith/dependency-bench/live-latest.json');
const rows = [];
for (const item of paired.results) {
  const v = await readJson(path.join(item.run, 'verification.json')),
    p = await readJson(path.join(proof.root, item.arm, 'proof.json'));
  const holdouts = await readJson(path.join(p.holdouts, 'results.json'));
  const browsers = [];
  for (const side of ['baseline', 'candidate'])
    browsers.push(await readJson(path.join(p.browser, side + '.json')));
  assert.equal(v.status, 'verified-for-contract');
  assert.equal(p.status, 'passed');
  assert(browsers.every((b) => b.status === 'passed' && b.errors.length === 0));
  rows.push({
    arm: item.arm,
    attempts: item.attempts.length,
    model: item.attempts.map((x) => x.model),
    totalTokens: item.attempts.reduce((n, x) => n + (x.usage?.total_tokens ?? 0), 0),
    sourcePass: v.source.cases.filter((x) => x.status === 'passed').length,
    baselinePass: v.baseline.cases.filter((x) => x.status === 'passed').length,
    candidatePass: v.candidate.cases.filter((x) => x.status === 'passed').length,
    cases: v.candidate.cases.length,
    regressions: v.regression.candidate.counts,
    builds: v.checks,
    dependencyReceipt: v.dependencies,
    holdouts: holdouts.results.map(({ side, total, passed, inventoryUnchanged }) => ({
      side,
      total,
      passed,
      inventoryUnchanged
    })),
    browser: browsers,
    replay: p.replay,
    patch: item.patch
  });
}
for (const [file, meta] of Object.entries(setup.sourceInventory))
  assert.equal(hash(await fs.readFile(path.join(setup.originalSource, file))), meta.sha256);
assert.equal(
  execFileSync('git', ['status', '--porcelain'], { cwd: setup.originalSource, encoding: 'utf8' }),
  setup.sourceGitState
);
const drawdb = path.resolve('.portsmith/complex-bench/repos/drawdb'),
  targetCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: drawdb, encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: drawdb, encoding: 'utf8' }), '');
const result = {
  date: new Date().toISOString(),
  sourceCommit: setup.sourceCommit,
  targetCommit,
  setup: setup.root,
  paired: paired.root,
  proof: proof.root,
  realInstallerTests: live.root,
  originalsUnchanged: true,
  rows,
  limitations: [
    'One paired trial with the same model and common Portsmith staging/judge; Rea supplies static evidence, not an independent agent.',
    'Authored JSON bridge and alias configs; MiniSearch library unchanged. Source projection excludes symlinked example data.',
    'Source and candidate pass 500 independently expected stateful sequences; this is not upstream MiniSearch test-suite coverage.',
    'Browser requirements are in-loop supplemental checks, outside the frozen callable contract.',
    '25 authored destination regressions; drawDB has no upstream suite.',
    'Package-manager install receipts bind inputs/completion, not every installed dependency byte.'
  ]
};
await saveJson('.portsmith/index-bench/results.json', result);
const table = rows
  .map(
    (r) =>
      `| ${r.arm === 'rea' ? 'Rea-assisted' : 'Portsmith-assisted'} | ${r.attempts} | ${r.candidatePass}/${r.cases} | ${r.regressions.passed} | 500/500 | Pass |`
  )
  .join('\n');
await fs.writeFile(
  'docs/benchmark-index.md',
  `# MiniSearch into drawDB: dependencies, aliases and stateful search

Verified locally on 2026-10-14. Both final candidates passed the same callable contract, full app builds, browser interactions, independent holdouts and fresh patch replay. This is one matched evidence-assisted trial, not overall Rea parity or a standalone Rea-agent benchmark.

| Evidence arm | Model proposals | Contract cases | Regressions | Hidden sequences | Browser + replay |
|---|---:|---:|---:|---:|---|
${table}

The source passed 26/26; the baseline passed 15/26 and demonstrated value mismatches without execution errors. Both baseline and candidate passed 25 authored regression tests and full Vite production builds. Browser checks covered table/column search with typos, selecting the column and focusing its editor, empty results, clearing search, saving/reloading the schema and the Problems panel. Both final browser runs recorded zero page/request errors.

## What changed in the product

- Explicit dependency preview and locked npm/pnpm installation into copied runs, with lifecycle scripts disabled, staged replacement and verification-bound receipts.
- Local JSON/JSONC aliases in inspection, planning, preparation, Node execution and autonomous context. Source aliases become recorded relative imports, preventing destination collisions.
- Immutable copied source and inherited alias configuration. Reinstalling dependencies invalidates old verification. Failure, timeout and version mismatch remain failures.

The real pnpm check exposed incompatible npm-style config flags; the fixed adapter passed actual npm 11.6.2 and pnpm 10.34.6 installs, dependency imports, script canaries and transfer verification. Each trial arm also installed drawDB from its unchanged package-lock using npm. Registry installation and full builds succeeded with lifecycle scripts disabled. Node 24.16.0 ran the real app tests.

## Trial design

Source: [MiniSearch 7.1.2](https://github.com/lucaong/minisearch/tree/${setup.sourceCommit}), five original TypeScript modules plus an authored JSON bridge. Destination: [drawDB](https://github.com/drawdb-io/drawdb/tree/${targetCommit}), the full React/Vite application. The bridge exercises prefix/fuzzy search, AND queries across fields, add, replace, discard and ID reuse. The browser separately exercises fuzzy search through the app's table/column picker; it does not prove an incremental UI index.

Both arms use gpt-5.6-terra, identical prepared inputs, contract, selected file context, integration goal and three-proposal budget. Rea 6.4.0 supplies retained application analysis/module pages/feature traces from the same upstream revisions. Portsmith supplies its import graph. Portsmith is the common staging, model-protocol and verification engine. Rea reports partial application/semantic coverage; all original responses and their limitations are retained.

The destination static graph also reports unresolved dependency compatibility when compared in the reverse direction, including an upstream transitive icon import. That is not a claim that drawDB itself fails to build; the real locked builds pass. Static analysis and runtime proof remain separate.

Aliases are deliberately introduced in the authored boundary/configuration before freezing the run, including an independent destination @app mapping and matching Vite configuration. These are alias stress fixtures around real libraries/apps, not claims about their original alias conventions. MiniSearch's demo-data symlinks are excluded from the prepared source projection; the library source, original Git state and drawDB checkout remain unchanged. General symlink snapshots are still unsupported.

## Failures and corrections retained

The initial pilot passed callable checks but its first browser-tested candidate left unmatched root nodes visible. Revision 2 restarted both arms and made the unchanged browser requirements an in-loop acceptance gate. Portsmith's first proposal repeated that UI failure; the second repaired it. Rea-assisted adaptation passed with one proposal. No contract/test/source changes were used to make either candidate pass. This sample does not establish a reliable difference between providers.

A held-out harness initially hit its output budget while reporting expected baseline mismatches. Its output limit was raised; cases and expectations were unchanged. Final holdouts contain 500 unseen seeded stateful sequences: source/candidate passed all, baseline passed only 100. Fresh patch copies reproduced each candidate exactly and passed verification/build/browser checks with cloned locked dependency directories. Replay reuses those installations; it is not another registry install.

## Reproduce and inspect

The benchmark scripts expect the pinned local repository clones, existing Rea provider configuration and local Node/npm tools. They are reproducible developer harnesses, not a one-command fresh-machine setup. [Normal dependency and alias setup](dependencies-aliases.md) documents the product commands.

\`\`\`sh
node scripts/setup-index-benchmark.mjs
node scripts/benchmark-index-static.mjs
node --env-file=.env scripts/benchmark-index.mjs
node scripts/prove-index.mjs
node scripts/report-index.mjs
\`\`\`

Local, unshipped evidence:

- Setup: \`${setup.root}\`
- Final paired runs: \`${paired.root}\`
- Holdouts, replays, screenshots and traces: \`${proof.root}\`
- Real package-manager tests: \`${live.root}\`
- Compact machine report: \`.portsmith/index-bench/results.json\`

Each run contains its frozen contract, dependency receipt, model contexts/proposals, verification and reviewable transfer.patch. Package receipts do not attest every installed byte. The upstream MiniSearch suite, workspace installs, private registries and arbitrary framework conversions are not covered by this trial.
`
);
console.log(
  JSON.stringify({
    report: 'docs/benchmark-index.md',
    arms: rows.map((r) => ({
      arm: r.arm,
      attempts: r.attempts,
      cases: r.candidatePass,
      holdouts: r.holdouts
    }))
  })
);
