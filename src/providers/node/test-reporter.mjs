// Node's test runner sends structured events to this reporter. File-level
// success and suite containers do not count as executed test assertions.
import path from 'node:path';

export default async function* reporter(events) {
  const counts = { version: 1, passed: 0, failed: 0, skipped: 0, todo: 0, complete: false };
  const diagnostics = [];
  let diagnosticBytes = 0;
  const record = (value) => {
    if (!value || diagnosticBytes >= 8000) return;
    const message = String(value).slice(0, 8000 - diagnosticBytes);
    diagnostics.push(message);
    diagnosticBytes += message.length;
  };
  for await (const event of events) {
    if (event.type === 'test:stderr') record(event.data?.message);
    if (event.type === 'test:fail') {
      const error = event.data?.details?.error;
      record(error?.cause?.stack ?? error?.stack ?? error?.message ?? event.data?.name);
    }
    if (event.type === 'test:pass' || event.type === 'test:fail') {
      const data = event.data;
      if (data.details?.type === 'suite' || data.details?.type === 'file') continue;
      // Node 22/23 labels an empty test file as a successful synthetic "test".
      if (
        data.file &&
        data.name &&
        data.line === 1 &&
        data.column === 1 &&
        path.resolve(data.name) === path.resolve(data.file)
      )
        continue;
      if (data.skip) counts.skipped++;
      else if (data.todo) counts.todo++;
      else if (event.type === 'test:fail') counts.failed++;
      else counts.passed++;
    }
  }
  if (diagnostics.length) counts.diagnostics = diagnostics;
  counts.complete = true;
  yield JSON.stringify(counts) + '\n';
}
