import fs from 'node:fs';

// Vitest 4.1 public completion API; deliberately a separate adapter from 0.34.
export function summarizeModernVitest(modules = [], errors = [], reason) {
  const counts = {
    version: 1,
    complete: reason === 'passed' && modules.length > 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    todo: 0,
    errors: errors.length,
    files: modules.map((module) => module.moduleId)
  };
  for (const module of modules) {
    if (module.state() !== 'passed' || module.errors().length) counts.errors++;
    for (const suite of module.children.allSuites()) {
      if (suite.state() !== 'passed' || suite.errors().length) counts.errors++;
    }
    let total = 0;
    for (const test of module.children.allTests()) {
      total++;
      const result = test.result();
      if (result.errors?.length) counts.errors += result.errors.length;
      if (test.options.mode === 'todo') counts.todo++;
      else if (result.state === 'passed') counts.passed++;
      else if (result.state === 'failed') counts.failed++;
      else if (result.state === 'skipped') counts.skipped++;
      else counts.complete = false;
    }
    if (!total) counts.errors++;
  }
  return counts;
}

export default class PortsmithModernVitestReporter {
  onTestRunEnd(modules, errors, reason) {
    fs.writeSync(3, JSON.stringify(summarizeModernVitest(modules, errors, reason)));
  }
}
