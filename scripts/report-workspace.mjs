import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readJson, saveJson, hash, inventory } from '../src/platform/files.mjs';
const base = path.resolve('.portsmith/workspace-bench'),
  paired = await readJson(path.join(base, 'paired-latest.json')),
  setup = await readJson(path.join(base, 'setup-latest.json'));
const rows = [],
  evidence = [];
for (const initial of paired.results) {
  const repair = await readJson(path.join(paired.root, 'repair-' + initial.arm + '-latest.json'));
  assert.equal(repair.status, 'verified-for-contract');
  const proof = await readJson(path.join(paired.root, 'proof-' + initial.arm + '-latest.json'));
  assert.equal(proof.status, 'passed');
  const v = await readJson(path.join(repair.run, 'verification.json'));
  const holdouts = await readJson(path.join(proof.holdouts, 'results.json'));
  const browser = await Promise.all(
    ['baseline', 'candidate'].map((side) => readJson(path.join(proof.browser, side + '.json')))
  );
  assert(browser.every((b) => b.status === 'passed'));
  const candidate = holdouts.results.find((r) => r.side === 'candidate');
  rows.push(
    `| ${initial.arm === 'rea' ? 'Rea-assisted' : 'Portsmith-assisted'} | ${initial.arm === 'rea' ? '1 proposal passed contract but added @ts-ignore; rejected in quality review' : '3 proposals exhausted; protected-file and missing-declaration failures'} | ${repair.attempts.length} proposal; passes without suppression | ${v.candidate.cases.length}/${v.candidate.cases.length}; ${v.regression.candidate.counts.passed} regressions | ${candidate.passed}/${candidate.total}; ${candidate.serde.passed}/${candidate.serde.total} decoders | Passed |`
  );
  evidence.push({
    arm: initial.arm,
    initialStatus: initial.status,
    initialAttempts: initial.attempts.length,
    repairAttempts: repair.attempts.length,
    verification: v.status,
    version: v.version,
    baselinePasses: v.baseline.cases.filter((c) => c.status === 'passed').length,
    contractCases: v.source.cases.length,
    regressions: v.regression.candidate.counts.passed,
    proof,
    patchSha256: hash(await fs.readFile(path.join(repair.run, 'transfer.patch')))
  });
}
const originalStatus = {};
for (const [name, repo] of [
  ['zod', setup.originalSource],
  ['mermaid-live-editor', path.resolve('.portsmith/complex-bench/repos/mermaid-live-editor')]
]) {
  originalStatus[name] = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });
  assert.equal(originalStatus[name], '');
}
const upstream = await readJson(path.join(base, 'zod-upstream-tests.json'));
assert(
  upstream.success &&
    upstream.numFailedTests === 0 &&
    upstream.numPendingTests === 0 &&
    upstream.numTodoTests === 0
);
const summary = {
  pairedRoot: paired.root,
  sourceCommit: setup.sourceCommit,
  sourceFiles: setup.sourceFiles,
  evidence,
  originalStatus,
  upstreamZodReportedAssertions: upstream.numPassedTests,
  engineInventory: await inventory(path.resolve('src'))
};
await saveJson(path.join(base, 'report.json'), summary);
const text = `# Workspace and framework-alias benchmark

On 14 October 2026, both repaired, evidence-assisted transfers passed the selected Zod-to-Mermaid task. The initial attempts exposed real usability gaps. This is not evidence of overall Rea parity or a measured reliability rate.

## What was tested

- Zod v4.1.12, commit \`${setup.sourceCommit}\`: a six-package pnpm workspace. A real locked pnpm 10.12.1 install preserved linked imports through adaptation and patch export. Selected unchanged upstream object/optional/nullable suites reported ${upstream.numPassedTests} passing runtime/type-check assertions, no skips or TODOs. These supplementary Vitest 2 results are not a new Portsmith Vitest 2 adapter.
- Mermaid Live Editor commit \`dd95c0328556e83ae42f6ee58d294c0badd922d9\`: Svelte 5, SvelteKit 2 and Vite 8, actual locked pnpm 10.34.6 installs, original static framework aliases, 164 existing regression assertions across 13 files, full Svelte/TypeScript checking, and both embed/editor production builds.
- Real npm 11.6.2 and pnpm 10.34.6 workspace fixtures: local member links plus a registry dependency, lifecycle canaries disabled, runtime imports preserved after adaptation, original inputs unchanged.
- IT-Tools' original Vite configuration was parsed successfully. This is alias-analysis evidence only, not a new runtime transfer trial. Zustand was inspected but not benchmarked.

## Controlled comparison

Both arms used GPT-5.6 Terra, the same complete copied source code, 23 frozen behavior cases, destination code/tests, and a common Portsmith execution/export judge. Only the supplemental static evidence differed. Rea 6.4.0 ran as a real MCP provider in a read-only container; its application/semantic coverage was partial, not complete. This compares evidence-assisted model integration, not standalone Rea and Portsmith agents.

| Evidence arm | Initial trial | Follow-up repair | Frozen behavior / upstream tests | Hidden cases / actual decoders | Patch replay + browser |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

The destination baseline passes ${evidence[0].baselinePasses}/23 frozen cases, 100/500 hidden shape cases, and 200/1000 decoder cases. Each repaired source/candidate passes all 500 hidden cases. Candidate checks exercise both base64 and pako deserialization, malformed objects, Unicode, control types and preservation of future fields. These generated cases are correlated examples, not 500 independent reliability trials.

Browser checks edit a real diagram, verify rendered SVG labels, inspect the Share URL, open it in a fresh browser context, reload it, and distinguish malformed-state acceptance in the baseline from the candidate's existing URL-failure UI. Both production app copies pass. Screenshots and Playwright traces are retained. These supplemental checks use online public assets; they do not establish offline support.

Fresh patch replay starts from each prepared baseline, applies the exported patch, requires matching candidate file hashes, and reruns all frozen checks. Replay reuses the previously installed locked dependencies; it is not another registry install.

## Failures retained and fixes made

1. Native Node strip-only execution rejected Zod's enum syntax. An explicit frozen \`runtime.transformTypes\` option now runs callable checks and Node regressions with Node's experimental transform; a new run was prepared. The old failed contract was not edited.
2. Full static export/limitation inventories exceeded the 1 MB model-context budget. The first pair sent no model requests. The corrected harness retains every source file and test, but explicitly projects the first 40 Portsmith export records and bounded Rea trace detail. Full raw evidence stays on disk; partial coverage and omission counts remain visible. One intermediate setup was interrupted before model adaptation.
3. The Portsmith-assisted model twice tried to add declarations inside the frozen feature directory. Those proposals were rejected. A valid runtime import still failed the full type check. Clearer destination-wrapper guidance repaired this in one additional proposal.
4. The first Rea-assisted proposal used \`@ts-ignore\`. Its raw contract pass is retained, but it was rejected in quality review. A matching follow-up removed suppression and added a destination wrapper/declaration in one proposal. Autonomous edits now reject increases in leading TypeScript suppression directives. This is a focused guard, not a detector for every possible bypass.

The initial trial and follow-up repair are separate phases. Do not report either final result as a first-try success. Existing contracts, tests, source implementation and compiler settings remained frozen through repairs.

## Authored boundaries and limits

The source projection omits Zod's symlinked README only; original Git checkouts remain clean. The 73-file extracted closure uses the original Zod implementation. A small shared-state schema bridge, 23-case contract, baseline validation helper and serde call site were authored before freezing. The model integrates that helper with the copied feature; it did not autonomously discover or design the whole validation feature. Patches apply to the prepared baseline, not directly to an untouched Mermaid checkout. Build/check wrappers were reviewed preparation carried over from the earlier benchmark.

Workspace support does not automatically inline every bare workspace-package import into a transferred closure. Dynamic/plugin aliases, injected or patched dependencies, private registries, Yarn/Bun, native builds and arbitrary cross-framework conversion remain outside the tested installer/alias paths. See [setup details](dependencies-aliases.md).

## Evidence and reproduction

- Final trial: \`${paired.root}\`.
- Initial context-budget failure: \`.portsmith/workspace-bench/paired-6Q5sBE\`; interrupted setup: \`paired-Fhhm53\`.
- Live Rea static evidence: \`.portsmith/rea-comparison/workspace-static-7ahXfl\`.
- Real workspace install receipts: \`.portsmith/workspace-bench/live-install-latest.json\` and \`zod-install-latest.json\`.
- Summary: \`.portsmith/workspace-bench/report.json\`; per-arm repair, replay, browser and holdout pointers live under the final trial.

The scripts require the pinned cloned repositories, the reviewed Mermaid baseline preparation from the earlier benchmark, Node 24.16.0, matching local pnpm binaries, Chromium/Python Playwright, and local model credentials. They are an explicit benchmark harness, not a one-command arbitrary-app migration.

\`setup-workspace-benchmark.mjs\` prepares reviewed inputs; \`benchmark-workspace-static.mjs\` records live Rea evidence; \`benchmark-workspace.mjs\` runs the pair. \`repair-workspace.mjs\` records follow-up repairs, \`prove-workspace.mjs\` runs supplemental proof, and \`report-workspace.mjs\` validates and writes this report. Re-running with today's clearer guidance can produce different model attempts; the historical failures above are retained.
`;
await fs.writeFile('docs/benchmark-workspace.md', text);
console.log(
  summary.evidence.map(({ arm, verification, regressions }) => ({ arm, verification, regressions }))
);
