import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { runProcess } from '../../platform/process.mjs';
import { hash, safePath } from '../../platform/files.mjs';

export async function runBrowser(run, side, artifactRoot, timeoutMs) {
  const output = path.join(artifactRoot, side);
  await fs.mkdir(output, { mode: 0o700 });
  const runner = fileURLToPath(new URL('./runner.mjs', import.meta.url));
  // Resolve in the caller, where HOME/XDG/PLAYWRIGHT_BROWSERS_PATH are known.
  // Pass only the executable path; repository subprocesses still receive no keys.
  const execution = await runProcess(
    process.execPath,
    [runner, path.join(run, 'contract.json'), output, chromium.executablePath()],
    {
      cwd: path.join(run, side),
      protocol: true,
      timeoutMs
    }
  );
  let result;
  try {
    result = JSON.parse(execution.protocol);
  } catch {
    result = { status: 'error', error: 'No completed browser result.', cases: [], regression: [] };
  }
  delete execution.protocol;
  if (execution.reason || execution.exitCode !== 0)
    result = {
      status: 'error',
      error: execution.reason ?? `Browser exited ${execution.exitCode}`,
      cases: [],
      regression: []
    };
  const artifacts = [];
  for (const file of await fs.readdir(output)) {
    const absolute = await safePath(output, file);
    const bytes = await fs.readFile(absolute);
    artifacts.push({ path: path.relative(run, absolute).split(path.sep).join('/'), sha256: hash(bytes) });
  }
  return { ...result, artifacts, execution };
}

export async function assertBrowserEvidence(run, report) {
  for (const side of ['baseline', 'candidate'])
    for (const item of report?.[side]?.artifacts ?? []) {
      const bytes = await fs.readFile(await safePath(run, item.path));
      if (hash(bytes) !== item.sha256)
        throw new Error('Browser evidence changed; verify again before export.');
    }
}
