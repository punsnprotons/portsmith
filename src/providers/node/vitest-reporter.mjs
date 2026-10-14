import fs from 'node:fs';

// Vitest 0.34 reporter lifecycle. Collection failures, hook failures, skips,
// unhandled errors and empty selected files all prevent a completed pass.
export function summarizeVitest(files = [], errors = []) {
  const counts = {
    version: 1,
    complete: true,
    passed: 0,
    failed: 0,
    skipped: 0,
    todo: 0,
    errors: errors.length,
    files: files.map((file) => file.filepath)
  };
  function visit(task) {
    if (task.type === 'suite') {
      if (task.result?.state === 'fail') counts.errors++;
      for (const child of task.tasks ?? []) visit(child);
    } else if (task.type === 'test') {
      if (task.mode === 'skip' || task.result?.state === 'skip') counts.skipped++;
      else if (task.mode === 'todo' || task.result?.state === 'todo') counts.todo++;
      else if (task.result?.state === 'pass') counts.passed++;
      else if (task.result?.state === 'fail') counts.failed++;
      else counts.complete = false;
    } else counts.complete = false;
  }
  for (const file of files) {
    const before = counts.passed + counts.failed + counts.skipped + counts.todo;
    visit(file);
    if (counts.passed + counts.failed + counts.skipped + counts.todo === before) counts.errors++;
  }
  if (!files.length) counts.complete = false;
  return counts;
}

export default class PortsmithVitestReporter {
  onFinished(files, errors) {
    fs.writeSync(3, JSON.stringify(summarizeVitest(files, errors)));
  }
}
