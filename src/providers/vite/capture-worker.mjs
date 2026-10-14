// Runs only in an explicitly authorized disposable repository copy.
import fs from 'node:fs/promises';
import { writeSync } from 'node:fs';
import path from 'node:path';
import { createRequire, isBuiltin } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { virtualModules } from './virtual-modules.mjs';
import { inventory, inside, relativeFile, hash } from '../../platform/files.mjs';
const root = process.cwd(),
  mode = process.argv[2],
  require = createRequire(path.join(root, 'package.json'));
process.env.NODE_ENV = 'production';
const vitePackage = require.resolve('vite/package.json');
const viteMetadata = JSON.parse(await fs.readFile(vitePackage, 'utf8'));
const vite = await import(
  pathToFileURL(
    path.resolve(
      path.dirname(vitePackage),
      typeof viteMetadata.exports?.['.'] === 'string'
        ? viteMetadata.exports['.']
        : (viteMetadata.exports?.['.']?.import ?? viteMetadata.main)
    )
  )
);
const files = await inventory(root),
  queries = [];
for (const rel of Object.keys(files)) {
  if (!/\.[cm]?[jt]sx?$/.test(rel) || /\.d\.[cm]?ts$/.test(rel)) continue;
  const ast = ts.createSourceFile(
    rel,
    await fs.readFile(path.join(root, rel), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const specs = new Set();
  function scan(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      specs.add(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    )
      specs.add(node.arguments[0].text);
    ts.forEachChild(node, scan);
  }
  scan(ast);
  for (const specifier of specs)
    if (!specifier.startsWith('.') && !isBuiltin(specifier)) {
      if (queries.length >= 4000) throw Error('Alias capture exceeds 4000 literal import pairs.');
      queries.push({ importer: rel, specifier });
    }
}
const planned = JSON.parse(process.argv[3] ?? '[]');
const seen = new Set(queries.map((q) => q.importer + '\0' + q.specifier));
for (const query of planned) {
  const key = query.importer + '\0' + query.specifier;
  if (!seen.has(key)) {
    queries.push(query);
    seen.add(key);
  }
}
if (queries.length > 4000) throw Error('Alias capture exceeds 4000 literal import pairs.');
const pendingVirtual = [];
const transformed = new Map();
const virtual = virtualModules(root, files, transformed);
let resolvedConfig,
  records,
  watchFiles = [];
const sentinel = '\0portsmith-alias-capture-entry';
const plugin = {
  name: 'portsmith-alias-capture',
  enforce: 'post',
  configResolved(c) {
    if (
      path.resolve(c.root) !== root ||
      c.mode !== mode ||
      c.command !== 'build' ||
      c.build.write !== false ||
      c.build.watch
    )
      throw Error('Config changed capture execution settings.');
    resolvedConfig = c;
  },
  buildStart: {
    order: 'post',
    sequential: true,
    async handler() {
      records = [];
      for (const query of queries) {
        let result;
        try {
          result = await this.resolve(query.specifier, path.join(root, query.importer), { skipSelf: true });
        } catch {
          records.push({ ...query, kind: 'unsupported' });
          continue;
        }
        let record = { ...query, kind: 'unresolved' };
        if (result) {
          const id = result.id;
          if (result.external) record.kind = 'external';
          else if (
            process.argv[4] === 'true' &&
            id.startsWith('\0') &&
            query.specifier.startsWith('virtual:')
          ) {
            record.kind = 'local';
            pendingVirtual.push({ record, id });
          } else if (id.includes('\0') || id.includes('?') || id.includes('#') || !path.isAbsolute(id))
            record.kind = 'unsupported';
          else if (!inside(root, id)) record.kind = 'outside';
          else if (path.relative(root, id).split(path.sep).includes('node_modules')) record.kind = 'external';
          else {
            record.kind = 'local';
            record.target = relativeFile(path.relative(root, id).split(path.sep).join('/'));
          }
        }
        records.push(record);
      }
    }
  },
  transform: {
    order: 'post',
    handler(code, id) {
      if (id.startsWith('\0')) transformed.set(id, code);
      return null;
    }
  },
  buildEnd() {
    watchFiles = typeof this.getWatchFiles === 'function' ? this.getWatchFiles() : [];
  },
  resolveId(id) {
    if (id === sentinel) return sentinel;
  },
  async load(id) {
    if (id === sentinel) {
      for (const item of pendingVirtual) item.record.target = await virtual.materialize(this, item.id);
      return 'export {};';
    }
  }
};
await vite.build({
  root,
  mode,
  envFile: false,
  logLevel: 'silent',
  plugins: [plugin],
  build: {
    write: false,
    emptyOutDir: false,
    copyPublicDir: false,
    watch: null,
    minify: false,
    lib: false,
    rollupOptions: { input: sentinel }
  }
});
if (!resolvedConfig || !records) throw Error('Vite did not complete alias capture.');
if (
  path.resolve(resolvedConfig.root) !== root ||
  resolvedConfig.mode !== mode ||
  resolvedConfig.command !== 'build'
)
  throw Error('Config changed the requested capture root, command or mode.');
const inputs = {};
for (const file of new Set(
  [
    ...(resolvedConfig.configFileDependencies ?? []),
    ...watchFiles.filter((f) => !f.includes('\0')),
    resolvedConfig.configFile,
    ...Object.keys(files)
      .filter((f) => /\.(?:json|jsonc|yaml|yml)$/.test(f))
      .map((f) => path.join(root, f)),
    ...[
      'package.json',
      'package-lock.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tsconfig.json',
      'jsconfig.json'
    ].map((x) => path.join(root, x))
  ].filter(Boolean)
)) {
  if (!inside(root, path.resolve(file))) throw Error('Config dependency outside copied repository.');
  const rel = path.relative(root, file).split(path.sep).join('/');
  if (rel.split('/').includes('node_modules')) continue;
  if (files[rel]) inputs[rel] = files[rel].sha256;
}
writeSync(
  3,
  JSON.stringify({
    version: 2,
    provider: 'vite-build',
    viteVersion: vite.version,
    mode,
    command: 'build',
    inputs,
    records: [
      ...records,
      ...virtual
        .entries()
        .flatMap((m) => m.packages.map((specifier) => ({ importer: m.path, specifier, kind: 'external' })))
    ],
    generated: virtual.entries(),
    plannedImports: planned,
    inputSnapshotSha256: hash(JSON.stringify(files)),
    limitations: [
      'Observed and explicitly planned literal import pairs only; other new bare imports require recapture.',
      'Virtual ESM is frozen after plugin load/transform; import.meta, assets and computed imports are unsupported.',
      'Config and plugins execute in a separate process, not a security sandbox.',
      'Dependency versions and a production build must be verified separately.'
    ]
  })
);
