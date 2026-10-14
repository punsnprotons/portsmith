// Separate process: code under test is executed, but this is NOT a security sandbox.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

let result;
try {
  const contract = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  if (contract.runtime?.aliases) await import('./register-aliases.mjs');
  else if (contract.runtime?.relativeImports) await import('./register-relative.mjs');
  const side = process.argv[3];
  const endpoint = side === 'source' ? contract.source : contract.target;
  const mod = await import(pathToFileURL(path.resolve(endpoint.module)).href);
  const fn = mod[endpoint.export];
  if (typeof fn !== 'function') throw new Error(`Missing callable export: ${endpoint.export}`);
  const cases = [];
  for (const test of contract.cases) {
    try {
      const actual = await fn(...structuredClone(side === 'source' ? test.sourceArgs : test.targetArgs));
      // Compare actual values, never JSON-normalized values (NaN must not equal null).
      const passed = isDeepStrictEqual(actual, test.expected);
      cases.push({
        name: test.name,
        status: passed ? 'passed' : 'mismatch',
        expected: test.expected,
        actual: actual === undefined ? '[undefined]' : actual
      });
    } catch (error) {
      cases.push({ name: test.name, status: 'error', error: String(error?.stack ?? error) });
    }
  }
  result = { status: cases.every((c) => c.status === 'passed') ? 'passed' : 'failed', cases };
} catch (error) {
  result = { status: 'error', error: String(error?.stack ?? error) };
}
fs.writeSync(3, JSON.stringify(result));
