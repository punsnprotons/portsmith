import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Deliberately old compatibility runners are dev-only. An unrelated or new
// advisory is a failure, not silently covered by a severity-wide exception.
const compatibilitySources = new Set([
  'GHSA-67mh-4wv8-2f99',
  'GHSA-5gmw-xhrv-c9v3',
  'GHSA-85c8-ppgw-ccpr',
  'GHSA-g4jq-h2w9-997c',
  'GHSA-jqfw-vq24-v9c3',
  'GHSA-93m4-6634-74q7',
  'GHSA-4w7w-66w2-5vf9',
  'GHSA-c27g-q93r-2cwf',
  'GHSA-v6wh-96g9-6wx3',
  'GHSA-fx2h-pf6j-xcff',
  'GHSA-5xrq-8626-4rwp'
]);
const compatibilityPackages = new Set(['vitest', 'vite', 'vite-node', 'tinypool', 'esbuild']);
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const results = {};
for (const [scope, args] of [
  ['production', ['--omit=dev']],
  ['all', []]
]) {
  const child = spawnSync('npm', ['audit', '--json', ...args], {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, npm_config_update_notifier: 'false' }
  });
  if (child.error || child.signal || ![0, 1].includes(child.status))
    throw Error(`Audit unavailable: ${scope}`);
  let audit;
  try {
    audit = JSON.parse(child.stdout);
  } catch {
    throw Error(`Invalid audit response: ${scope}`);
  }
  if (audit.error || !audit.metadata?.vulnerabilities) throw Error(`Audit incomplete: ${scope}`);
  const findings = Object.values(audit.vulnerabilities ?? {});
  for (const finding of findings) {
    if (
      scope === 'production' ||
      !compatibilityPackages.has(finding.name) ||
      !finding.nodes?.length ||
      !finding.nodes.every((node) => lock.packages[node]?.dev === true) ||
      !finding.via.every((via) =>
        typeof via === 'string'
          ? compatibilityPackages.has(via)
          : compatibilitySources.has(via.url?.split('/').pop())
      )
    )
      throw Error(`Unreviewed dependency advisory: ${finding.name} (${scope})`);
  }
  results[scope] = { counts: audit.metadata.vulnerabilities, findings };
}
if (process.env.PORTSMITH_AUDIT_OUTPUT) {
  const output = path.resolve(process.env.PORTSMITH_AUDIT_OUTPUT);
  fs.writeFileSync(output, JSON.stringify(results, null, 2) + '\n', { flag: 'wx' });
}
console.log(
  JSON.stringify(
    {
      production: results.production.counts,
      compatibilityOnly: results.all.counts,
      note: 'See SECURITY.md; dev exceptions are not a clean all-dependency audit.'
    },
    null,
    2
  )
);
