import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relativeFile, safePath } from '../../platform/files.mjs';
import { runProcess } from '../../platform/process.mjs';

function regressionSpec(regression) {
  if (!regression || !/^node(?:\.exe)?$/.test(path.basename(regression.command))) return null;
  if (regression.args[0] === '--test') return { runner: 'node', files: regression.args.slice(1) };
  if (regression.args[0] !== 'node_modules/vitest/vitest.mjs' || regression.args[1] !== 'run') return null;
  const args = regression.args.slice(2),
    options = [];
  if (args[0] === '--environment=jsdom' || args[0] === '--environment=node') options.push(args.shift());
  return { runner: 'vitest', files: args, options };
}

// Explicit files and structured completion events; exit zero alone is never evidence.
export function regressionFiles(regression) {
  const files = regressionSpec(regression)?.files;
  if (!files?.length || new Set(files).size !== files.length) return null;
  try {
    for (const rel of files) {
      relativeFile(rel);
      if (rel.startsWith('-') || /[*?\[\]{}]/.test(rel) || !/\.[cm]?[jt]s$/.test(rel)) return null;
    }
  } catch {
    return null;
  }
  return files;
}

export async function runRegression(regression, cwd, timeoutMs, runtime) {
  cwd = await fs.realpath(cwd);
  const files = regressionFiles(regression);
  if (!files)
    return {
      status: 'failed',
      error:
        'Regression evidence requires node --test FILE... or node node_modules/vitest/vitest.mjs run [--environment=jsdom|node] FILE... with explicit test-file paths. Arbitrary exit-zero commands are not test evidence.'
    };
  for (const rel of files) await safePath(cwd, rel);
  if (regressionSpec(regression).runner === 'vitest') {
    let version;
    try {
      version = JSON.parse(
        await fs.readFile(path.join(cwd, 'node_modules/vitest/package.json'), 'utf8')
      ).version;
    } catch {}
    const modern = /^4\.1\.\d+$/.test(version ?? '');
    if (!modern && !/^0\.34\.\d+$/.test(version ?? ''))
      return {
        status: 'failed',
        error: `Vitest completion adapters support 0.34.x and 4.1.x; installed version: ${version ?? 'missing'}.`
      };
    const reporter = fileURLToPath(
      new URL(modern ? './vitest-modern-reporter.mjs' : './vitest-reporter.mjs', import.meta.url)
    );
    const execution = await runProcess(
      regression.command,
      [
        regression.args[0],
        'run',
        ...regressionSpec(regression).options,
        ...(modern ? ['--maxWorkers=1', '--no-file-parallelism'] : ['--threads=false']),
        `--reporter=${reporter}`,
        ...files
      ],
      { cwd, timeoutMs, protocol: true }
    );
    let counts;
    try {
      counts = JSON.parse(execution.protocol);
    } catch {}
    delete execution.protocol;
    const seen = counts?.files?.map((file) => path.relative(cwd, file).split(path.sep).join('/')).sort();
    const selected = [...files].sort();
    const valid =
      counts?.version === 1 &&
      counts.complete === true &&
      Number.isInteger(counts.passed) &&
      counts.passed > 0 &&
      counts.failed === 0 &&
      counts.skipped === 0 &&
      counts.todo === 0 &&
      counts.errors === 0 &&
      JSON.stringify(seen) === JSON.stringify(selected);
    return {
      status: execution.exitCode === 0 && !execution.reason && valid ? 'passed' : 'failed',
      runner: `vitest@${version}`,
      ...(counts ? { counts } : { error: 'No valid completed Vitest evidence.' }),
      execution
    };
  }
  // Test-process IPC carries actual test events, unlike a log parser that can
  // mistake a passed file containing zero tests for a passing test suite.
  const reporter = fileURLToPath(new URL('./test-reporter.mjs', import.meta.url));
  const execution = await runProcess(
    regression.command,
    [
      ...(runtime?.transformTypes ? ['--experimental-transform-types'] : []),
      ...(runtime?.aliases
        ? ['--import', fileURLToPath(new URL('./register-aliases.mjs', import.meta.url))]
        : runtime?.relativeImports
          ? ['--import', fileURLToPath(new URL('./register-relative.mjs', import.meta.url))]
          : []),
      '--test',
      `--test-reporter=${reporter}`,
      ...files
    ],
    { cwd, timeoutMs }
  );
  delete execution.protocol;
  let counts;
  try {
    counts = JSON.parse(execution.stdout.trim());
  } catch {}
  const valid =
    counts &&
    counts.version === 1 &&
    Number.isInteger(counts.passed) &&
    counts.passed > 0 &&
    counts.failed === 0 &&
    counts.skipped === 0 &&
    counts.todo === 0 &&
    counts.complete === true;
  return {
    status: execution.exitCode === 0 && !execution.reason && valid ? 'passed' : 'failed',
    ...(counts ? { counts } : { error: 'No valid completed test evidence.' }),
    execution
  };
}
