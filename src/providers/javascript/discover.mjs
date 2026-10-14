import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { rootDir, excluded, safePath, hash } from '../../platform/files.mjs';
import { exportObservations } from './exports.mjs';

// Bounded lexical discovery. No modules are imported and no source text is returned.
export async function discover({ source, query = '', limit = 20 }) {
  source = await rootDir(source);
  const terms = query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const candidates = [],
    omissions = {};
  let visited = 0,
    scanned = 0,
    bytes = 0,
    stopped = false;
  const omit = (reason) => {
    omissions[reason] = (omissions[reason] ?? 0) + 1;
  };
  async function walk(dir, prefix = '', depth = 0) {
    if (depth > 40) {
      omit('depth-limit');
      return;
    }
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (++visited > 5000) {
        stopped = true;
        return;
      }
      const rel = prefix + entry.name;
      if (excluded(rel) || entry.name.startsWith('.')) {
        omit('excluded');
        continue;
      }
      if (entry.isSymbolicLink()) {
        omit('symlink');
        continue;
      }
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel + '/', depth + 1);
      else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(rel) && !/\.d\.[cm]?ts$/.test(rel)) {
        const filename = await safePath(source, rel);
        const stat = await fs.stat(filename);
        if (stat.size > 512000) {
          omit('file-size-limit');
          continue;
        }
        if (bytes + stat.size > 20000000) {
          stopped = true;
          return;
        }
        const content = await fs.readFile(filename, 'utf8');
        bytes += Buffer.byteLength(content);
        scanned++;
        if (bytes > 20000000 || Buffer.byteLength(content) > 512000) {
          stopped = true;
          return;
        }
        const ast = ts.createSourceFile(rel, content, ts.ScriptTarget.Latest, true);
        if (ast.parseDiagnostics.length) {
          omit('parse-error');
          continue;
        }
        const exports = exportObservations(ast, rel).filter((e) => !e.typeOnly);
        const exportedBindings = ast.statements.flatMap((node) => {
          if (
            node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
            node.name &&
            ts.isIdentifier(node.name)
          )
            return [node.name.text];
          if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) return [node.expression.text];
          return [];
        });
        const names = exports
          .map((e) => e.name)
          .concat(exportedBindings)
          .join(' ')
          .toLowerCase();
        const filenameText = rel.toLowerCase(),
          body = content.toLowerCase();
        const matches = terms.map((term) =>
          names.includes(term) ? 10 : filenameText.includes(term) ? 6 : body.includes(term) ? 1 : 0
        );
        if (terms.length ? matches.some((n) => n === 0) : !exports.length) continue;
        candidates.push({
          entry: rel,
          sha256: hash(content),
          score: matches.reduce((a, b) => a + b, 0),
          exports,
          exportedBindings,
          reasons: terms.length
            ? terms.map((term, i) => ({
                term,
                match: matches[i] === 10 ? 'export' : matches[i] === 6 ? 'path' : 'body'
              }))
            : [],
          inspect: { command: 'inspect', input: { source, entry: rel } }
        });
      } else omit('unsupported-or-declaration');
      if (stopped) return;
    }
  }
  await walk(source);
  candidates.sort((a, b) => b.score - a.score || a.entry.localeCompare(b.entry));
  return {
    source,
    query,
    candidates: candidates.slice(0, limit),
    totalMatches: candidates.length,
    coverage: {
      status:
        stopped ||
        omissions['parse-error'] ||
        omissions['file-size-limit'] ||
        omissions['depth-limit'] ||
        omissions.symlink
          ? 'partial'
          : 'complete-within-supported-scope',
      scanned,
      bytes,
      visited,
      budgetExhausted: stopped,
      omitted: omissions,
      resultsTruncated: candidates.length > limit
    },
    limitations: [
      'Lexical ranking is not semantic feature identification or runtime proof. Inspect a candidate before planning its transfer.',
      'Only JS/TS source is parsed. Hidden/generated/dependency directories, declarations, symlinks and other formats are excluded. No matches does not prove absence.'
    ]
  };
}
