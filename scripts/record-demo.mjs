import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { browserFixture } from './browser-fixture.mjs';
import { prepare, adapt, verify, exportPatch } from '../src/index.mjs';
import { startApp } from '../src/providers/browser/server.mjs';

// Presentation palette: paper #f4f6f8, ink #182b3a, blue #2864d7,
// copper #8b4c2c, slate #526775, white #ffffff. System sans + mono.
// Two real catalog frames are the focal point; no simulated app interactions.
const project = path.resolve(import.meta.dirname, '..');
const parent = path.join(project, '.portsmith');
await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'recording-'));
const assets = path.join(project, 'docs/assets');
await fs.mkdir(assets, { recursive: true });
const options = await browserFixture(root);
await prepare(options);
await adapt(options.out, path.join(root, 'proposal.json'));
const report = await verify(options.out, { allowExecution: true, timeoutMs: 30000 });
assert.equal(report.status, 'verified-for-contract');
assert.equal(report.browser.status, 'passed');
const patch = await exportPatch(options.out);
assert.equal(patch.status, 'patch-ready');
const count = (value) => `${value.cases.filter((c) => c.status === 'passed').length}/${value.cases.length}`;
const baseline = await startApp(path.join(options.out, 'baseline'), { page: 'index.html' });
const candidate = await startApp(path.join(options.out, 'candidate'), { page: 'index.html' });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    recordVideo: { dir: root, size: { width: 1280, height: 900 } },
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Portsmith — a feature transfer</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#182b3a;font-family:system-ui,sans-serif;padding:36px 48px}.brand{display:flex;align-items:center;justify-content:space-between;font-size:20px;font-weight:700}.brand span{font:12px ui-monospace,monospace;color:#526775}.mark{color:#2864d7;margin-right:8px}h1{font-size:44px;letter-spacing:-.045em;margin:26px 0 8px;line-height:1.1}.sub{margin:0;color:#526775;font-size:16px}.panels{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:26px}.panel{border:1px solid #b4c1c9;border-radius:8px;overflow:hidden;background:white}.bar{padding:14px 20px;display:flex;justify-content:space-between;border-bottom:1px solid #dde4e9;font-size:13px;font-weight:600}.before{color:#8b4c2c}.after{color:#2864d7}iframe{display:block;width:100%;height:480px;border:0}.result{margin-top:22px;display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid #b4c1c9;padding-top:18px;gap:20px}.result small{display:block;color:#526775;font-size:12px;margin-bottom:5px}.result strong{font-size:18px}.footer{display:flex;justify-content:space-between;align-items:center;margin-top:24px;font-size:13px}.footer code{color:#2864d7;font-size:12px}#step{color:#526775;max-width:640px}
</style></head><body><div class="brand"><div><b class="mark">↳</b> portsmith</div><span>AUTHORED DEMO · NO MODEL · PUBLIC ALPHA</span></div><h1>Bring the feature. Keep the proof.</h1><p class="sub">A table filter becomes catalog search. Original repositories stay unchanged.</p><div class="panels"><section class="panel"><div class="bar"><span>01 / BEFORE</span><span class="before">Search returns everything</span></div><iframe title="Unchanged destination" id="before" src="${baseline.origin}"></iframe></section><section class="panel"><div class="bar"><span>02 / AFTER</span><span class="after">Filter integrated in a copy</span></div><iframe title="Verified candidate" id="after" src="${candidate.origin}"></iframe></section></div><div class="result"><div><small>Source contract</small><strong>${count(report.source)} passed</strong></div><div><small>Destination contract</small><strong>${count(report.baseline)} → ${count(report.candidate)}</strong></div><div><small>Existing tests</small><strong>${report.regression.candidate.counts.passed} passed · both copies</strong></div><div><small>Export</small><strong>Patch replay checked</strong></div></div><div class="footer"><span id="step">Recorded browser interaction · included authored proposal · no model</span><code>github.com/punsnprotons/portsmith</code></div></body></html>`);
  const before = page.frameLocator('#before');
  const after = page.frameLocator('#after');
  await before.locator('li').first().waitFor();
  await after.locator('li').first().waitFor();
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const caption = (value) =>
    page.locator('#step').evaluate((el, text) => {
      el.textContent = text;
    }, value);
  await pause(2500);
  await caption('Same query, different behavior: case-insensitive search.');
  await before.getByLabel('Search products').pressSequentially('TEA', { delay: 180 });
  await after.getByLabel('Search products').pressSequentially('TEA', { delay: 180 });
  assert.equal(await before.locator('li').count(), 3);
  assert.deepEqual(await after.locator('li').allTextContents(), ['Tea leaves']);
  await page.screenshot({ path: path.join(assets, 'transfer-demo.png') });
  await pause(4500);
  await caption('Accent handling comes with the feature: “cafe” finds “Café beans”.');
  await before.getByLabel('Search products').fill('cafe');
  await after.getByLabel('Search products').fill('cafe');
  assert.equal(await before.locator('li').count(), 3);
  assert.deepEqual(await after.locator('li').allTextContents(), ['Café beans']);
  await pause(4500);
  await caption('Reset still works. Existing destination tests and browser regressions pass.');
  await before.getByRole('button', { name: 'Reset' }).click();
  await after.getByRole('button', { name: 'Reset' }).click();
  assert.equal(await before.locator('li').count(), 3);
  assert.equal(await after.locator('li').count(), 3);
  assert.equal(await after.getByLabel('Search products').inputValue(), '');
  await pause(3500);
  await caption('Try it: npx --yes --package=portsmith-workbench@alpha portsmith-demo');
  await pause(6000);
  assert.deepEqual(errors, []);
  const video = page.video();
  await context.close();
  const webm = await video.path();
  // A local ffmpeg is required only to regenerate the marketing media.
  const encode = (args) => {
    const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      encoding: 'utf8'
    });
    if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
  };
  encode([
    '-i',
    webm,
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    path.join(root, 'transfer-demo.mp4')
  ]);
  encode([
    '-i',
    webm,
    '-vf',
    'fps=8,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
    '-loop',
    '0',
    path.join(assets, 'transfer-demo.gif')
  ]);
  const digest = async (file) =>
    createHash('sha256')
      .update(await fs.readFile(file))
      .digest('hex');
  await fs.writeFile(
    path.join(assets, 'demo-receipt.json'),
    JSON.stringify(
      {
        adaptation: 'included authored proposal; no model',
        scope: 'source checkout catalog fixture; not a benchmark of arbitrary applications',
        verifiedAt: report.verifiedAt,
        status: report.status,
        source: count(report.source),
        baseline: count(report.baseline),
        candidate: count(report.candidate),
        regression: {
          baseline: report.regression.baseline.counts,
          candidate: report.regression.candidate.counts
        },
        browser: report.browser.status,
        patchReplay: patch.status,
        patchSha256: patch.sha256,
        contractSha256: report.contractSha256,
        recordingAssertions: [
          'before TEA: 3 products',
          'after TEA: Tea leaves',
          'after cafe: Café beans',
          'reset: 3 products and empty query',
          'no page errors'
        ],
        media: {
          'transfer-demo.gif': await digest(path.join(assets, 'transfer-demo.gif')),
          'transfer-demo.png': await digest(path.join(assets, 'transfer-demo.png'))
        }
      },
      null,
      2
    ) + '\n'
  );
  console.log(`Recorded verified example. Public media: ${assets}\nPrivate video and raw evidence: ${root}`);
} finally {
  await browser?.close();
  await baseline.close();
  await candidate.close();
}
