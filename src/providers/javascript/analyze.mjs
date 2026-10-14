import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { isBuiltin } from 'node:module';
import { loadAliases, aliasTarget, relativeAlias } from './aliases.mjs';
import { exportObservations } from './exports.mjs';
import { rootDir, safePath, relativeFile, hash, inside } from '../../platform/files.mjs';

const code = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const packageName = (spec) =>
  spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
async function manifest(root) {
  try {
    return JSON.parse(await fs.readFile(await safePath(root, 'package.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

export async function analyze({
  source,
  target,
  entry,
  mount = 'src/features/imported',
  runtimeOnly = false,
  aliases = false
}) {
  source = await rootDir(source);
  target = target === undefined ? null : await rootDir(target);
  relativeFile(entry);
  relativeFile(mount);
  if (target && (inside(source, target) || inside(target, source)))
    throw new Error('Source and destination must be separate, non-nested directories.');
  const [sm, tm] = await Promise.all([manifest(source), target ? manifest(target) : {}]);
  const sourceDeps = { ...sm.devDependencies, ...sm.peerDependencies, ...sm.dependencies };
  const targetDeps = { ...tm.devDependencies, ...tm.peerDependencies, ...tm.dependencies };
  const aliasConfig = aliases ? await loadAliases(source) : { mappings: [], files: [] };
  const rewrites = [];
  const files = [],
    edges = [],
    exports = [],
    blockers = [],
    externals = new Map(),
    visited = new Set();
  const options = {
    allowJs: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    resolveJsonModule: true
  };

  async function visit(rel) {
    if (visited.has(rel)) return;
    visited.add(rel);
    if (visited.size > 300) throw new Error('Dependency closure exceeds 300 files; narrow the entry point.');
    const absolute = await safePath(source, rel);
    const stat = await fs.stat(absolute);
    if (stat.size > 2_000_000) throw new Error(`Feature file exceeds 2 MB: ${rel}`);
    const bytes = await fs.readFile(absolute);
    files.push({ path: rel, sha256: hash(bytes), bytes: bytes.length });
    if (!code.test(rel)) {
      blockers.push(`${rel}: non-JavaScript/TypeScript assets require an explicit adapter.`);
      return;
    }
    const ast = ts.createSourceFile(rel, bytes.toString('utf8'), ts.ScriptTarget.Latest, true);
    for (const diagnostic of ast.parseDiagnostics ?? [])
      blockers.push(`${rel}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
    exports.push(...exportObservations(ast, rel));
    const imports = [];
    function scan(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        const bindings = ts.isImportDeclaration(node) ? node.importClause : node;
        const named = bindings?.namedBindings ?? node.exportClause;
        const typeOnly =
          bindings?.isTypeOnly ||
          (!bindings?.name && named?.elements?.length > 0 && named.elements.every((e) => e.isTypeOnly));
        if (!runtimeOnly || !typeOnly)
          imports.push({
            spec: node.moduleSpecifier.text,
            pos: node.getStart(ast),
            literal: node.moduleSpecifier
          });
      }
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        if (!runtimeOnly || !node.isTypeOnly)
          imports.push({
            spec: node.moduleReference.expression?.text,
            pos: node.getStart(ast),
            commonjs: true
          });
      }
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteralLike(arg))
          imports.push({
            spec: arg.text,
            pos: node.getStart(ast),
            literal: arg,
            commonjs: ts.isIdentifier(node.expression)
          });
        else blockers.push(`${rel}: computed import/require cannot be traced safely.`);
      }
      if (ts.isIdentifier(node) && ['__dirname', '__filename'].includes(node.text))
        blockers.push(`${rel}: location-dependent ${node.text} needs review.`);
      if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression))
        blockers.push(`${rel}: import.meta usage needs review.`);
      ts.forEachChild(node, scan);
    }
    scan(ast);
    // A JS feature's adjacent declarations are part of its usable TS surface.
    // Keep the original declaration text rather than generating weaker types.
    const declaration = /\.[cm]?js$/.test(rel)
      ? rel.replace(
          /\.(cjs|mjs|js)$/,
          (_, ext) => `.d.${ext === 'cjs' ? 'cts' : ext === 'mjs' ? 'mts' : 'ts'}`
        )
      : null;
    if (declaration && !runtimeOnly) {
      try {
        await safePath(source, declaration);
        await visit(declaration);
      } catch (error) {
        if (error.code !== 'ENOENT') blockers.push(`${rel}: ${error.message}`);
      }
    }
    for (const item of imports) {
      const spec = item.spec;
      if (typeof spec !== 'string') {
        blockers.push(`${rel}: unsupported import.`);
        continue;
      }
      const line = ast.getLineAndCharacterOfPosition(item.pos).line + 1;
      let mapped;
      try {
        mapped = !spec.startsWith('.') ? aliasTarget(spec, aliasConfig, rel) : null;
      } catch (error) {
        blockers.push(`${rel}:${line}: ${error.message}`);
        continue;
      }
      if (mapped && item.commonjs) {
        blockers.push(`${rel}:${line}: CommonJS alias resolution is unsupported; use ESM imports.`);
        continue;
      }
      const lookup = mapped ? relativeAlias(rel, mapped) : spec;
      if (spec.startsWith('.') || mapped) {
        const resolved = ts.resolveModuleName(lookup, absolute, options, ts.sys).resolvedModule;
        if (!resolved || !inside(source, path.resolve(resolved.resolvedFileName))) {
          blockers.push(`${rel}:${line}: unresolved or escaping import ${spec}`);
          continue;
        }
        let resolvedName = resolved.resolvedFileName;
        // TypeScript resolves './feature.js' to feature.d.ts when both exist.
        // That is correct for type checking, but tracing must retain the runtime.
        if (/\.d\.[cm]?ts$/.test(resolvedName)) {
          const runtime = resolvedName.replace(
            /\.d\.(cts|mts|ts)$/,
            (_, ext) => `.${ext === 'cts' ? 'cjs' : ext === 'mts' ? 'mjs' : 'js'}`
          );
          try {
            if ((await fs.stat(runtime)).isFile()) resolvedName = runtime;
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }
        const dependency = path.relative(source, resolvedName).split(path.sep).join('/');
        edges.push({ from: rel, to: dependency, specifier: spec, line, ...(mapped ? { alias: true } : {}) });
        if (mapped) {
          const start = item.literal.getStart(ast),
            end = item.literal.end;
          rewrites.push({
            path: rel,
            start,
            end,
            original: bytes.toString('utf8').slice(start, end),
            specifier: spec,
            replacement: lookup,
            resolved: dependency
          });
        }
        try {
          await visit(dependency);
        } catch (error) {
          blockers.push(`${rel}: ${error.message}`);
        }
      } else if (isBuiltin(spec)) {
        externals.set(spec, { name: spec, kind: 'node-builtin', status: 'runtime-dependent' });
      } else {
        const name = packageName(spec);
        if (!sourceDeps[name])
          blockers.push(`${rel}:${line}: ${spec} is an undeclared package or unsupported path alias.`);
        else {
          const status = !target
            ? 'not-compared'
            : targetDeps[name] === sourceDeps[name]
              ? 'same-declared-range'
              : targetDeps[name]
                ? 'conflict'
                : 'missing';
          externals.set(name, {
            name,
            sourceRange: sourceDeps[name],
            targetRange: targetDeps[name] ?? null,
            status
          });
          if (target && status !== 'same-declared-range')
            blockers.push(
              `${name}: destination dependency is ${status}; resolve manifests explicitly before preparing.`
            );
        }
      }
    }
  }
  await visit(entry);
  const licenses = [];
  for (const name of await fs.readdir(source)) {
    if (/^(?:(?:MIT|BSD|APACHE|ISC)[-_])?(LICENSE|LICENCE|COPYING|NOTICE)(\..*)?$/i.test(name)) {
      const file = await safePath(source, name);
      if ((await fs.stat(file)).isFile())
        licenses.push({ path: name, sha256: hash(await fs.readFile(file)) });
    }
  }
  return {
    version: 1,
    source,
    target,
    entry,
    mount,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    edges,
    exports,
    ...(aliases ? { aliases: { ...aliasConfig, rewrites } } : {}),
    externals: [...externals.values()],
    license: { declared: sm.license ?? null, files: licenses },
    blockers: [...new Set(blockers)],
    limitations: [
      ...(!target ? ['No destination supplied; dependency compatibility was not compared.'] : []),
      'Static, file-level import closure; this is not runtime or behavior proof.',
      'Export observations cover top-level ESM declarations and literal CommonJS assignments. Function syntax is not runtime callability; conditional, dynamic and transitive re-exports are not resolved.',
      'Aliases require explicit enablement and data-only local configuration. Computed imports, non-code assets and cross-framework conversion remain unsupported.',
      'Only literal imports are traced. Runtime file reads, implicit globals, environment assumptions and transitive package behavior require review.',
      'Matching dependency ranges do not prove installed-version compatibility; root license files do not establish every file license.'
    ]
  };
}
