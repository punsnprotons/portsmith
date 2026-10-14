import path from 'node:path';
import ts from 'typescript';
import { isBuiltin } from 'node:module';
import { hash, inside, relativeFile } from '../../platform/files.mjs';
import { relativeAlias, rewriteAliases } from '../javascript/aliases.mjs';

export const virtualDirectory = 'portsmith-virtual';
// Capture transformed ESM, never a bundle: package implementation and licenses stay upstream.
export function virtualModules(root, files, transformed) {
  const modules = new Map();
  let total = 0;
  async function materialize(context, id) {
    if (modules.has(id)) return modules.get(id).path; // Cycles keep a stable file identity.
    if (modules.size >= 100) throw Error('Virtual module limit exceeds 100.');
    const target = `${virtualDirectory}/${hash(id).slice(0, 32)}.mjs`;
    const item = { path: target, idSha256: hash(id) };
    modules.set(id, item);
    const info = await context.load({ id });
    const code = info?.code ?? context.getModuleInfo(id)?.code ?? transformed.get(id);
    if (typeof code !== 'string' || Buffer.byteLength(code) > 500000)
      throw Error('Virtual module has no bounded transformed JavaScript.');
    total += Buffer.byteLength(code);
    if (total > 2000000) throw Error('Virtual module output exceeds 2 MB.');
    const ast = ts.createSourceFile(target, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (ast.parseDiagnostics.length) throw Error('Virtual module is not JavaScript.');
    const imports = [],
      rewrites = [];
    function scan(node) {
      if (ts.isMetaProperty(node)) throw Error('Virtual import.meta output is not portable.');
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        if (!ts.isStringLiteral(node.moduleSpecifier) || node.attributes)
          throw Error('Virtual import attributes are unsupported.');
        imports.push(node.moduleSpecifier);
      }
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression) && ['require', 'eval'].includes(node.expression.text))
          throw Error('Virtual CommonJS/eval output is unsupported.');
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0]))
            throw Error('Computed virtual imports are unsupported.');
          imports.push(node.arguments[0]);
        }
      }
      ts.forEachChild(node, scan);
    }
    scan(ast);
    const packages = [];
    for (const literal of imports) {
      const spec = literal.text;
      if (isBuiltin(spec)) continue;
      const result = await context.resolve(spec, id, { skipSelf: true });
      if (!result) throw Error('Unresolved virtual dependency.');
      let mapped;
      if (
        result.external ||
        (path.isAbsolute(result.id) &&
          inside(root, result.id) &&
          path.relative(root, result.id).split(path.sep).includes('node_modules'))
      ) {
        if (spec.startsWith('.') || spec.startsWith('/') || spec.includes(':'))
          throw Error('Non-package virtual external dependency.');
        packages.push(spec);
        continue;
      }
      if (result.id.startsWith('\0') && !result.id.includes('?'))
        mapped = await materialize(context, result.id);
      else if (path.isAbsolute(result.id) && inside(root, result.id) && !/[?#\0]/.test(result.id)) {
        mapped = relativeFile(path.relative(root, result.id).split(path.sep).join('/'));
        if (!files[mapped] || !/\.[cm]?[jt]s$/.test(mapped))
          throw Error('Virtual dependency is not snapshot code.');
      } else throw Error('Unsupported virtual dependency.');
      rewrites.push({
        start: literal.getStart(ast),
        end: literal.end,
        original: literal.getText(ast),
        replacement: relativeAlias(target, mapped)
      });
    }
    item.content = rewriteAliases(code, rewrites);
    item.sha256 = hash(item.content);
    item.packages = [...new Set(packages)];
    return target;
  }
  return { materialize, entries: () => [...modules.values()] };
}
