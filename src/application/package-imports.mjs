import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { isBuiltin } from 'node:module';
import { proposalSchema } from '../contracts/commands.mjs';
import { inventory, readJson, rootDir, relativeFile, hash, safePath } from '../platform/files.mjs';
import { workspaceLayout } from '../providers/dependencies/workspaces.mjs';

const code = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const groups = (m) => ({
  ...m.peerDependencies,
  ...m.devDependencies,
  ...m.optionalDependencies,
  ...m.dependencies
});
const registryRange = (value) =>
  typeof value === 'string' && /^[\d*^~<>=v][\dA-Za-z.*^~<>=|+ -]*$/.test(value);
export async function discoverImports({ source, proposal, dependencySource }) {
  source = await rootDir(source);
  const files = await inventory(source);
  const layout = await workspaceLayout(source, await readJson(await safePath(source, 'package.json')));
  const catalog = new Map();
  if (dependencySource) {
    dependencySource = await rootDir(dependencySource);
    const donor = await workspaceLayout(
      dependencySource,
      await readJson(await safePath(dependencySource, 'package.json'))
    );
    for (const pkg of donor.packages)
      for (const [name, range] of Object.entries(groups(pkg.manifest))) {
        const entries = catalog.get(name) ?? new Set();
        entries.add(range);
        catalog.set(name, entries);
      }
  }
  let edits,
    proposalSha256 = null;
  if (proposal) {
    const bytes = await fs.readFile(proposal);
    if (bytes.length > 2000000) throw Error('Import proposal exceeds 2 MB.');
    proposalSha256 = hash(bytes);
    edits = proposalSchema.parse(JSON.parse(bytes)).edits;
    const seen = new Set();
    for (const edit of edits) {
      relativeFile(edit.path);
      if (!code.test(edit.path)) throw Error('Import discovery proposals may only contain JS/TS edits.');
      if (seen.has(edit.path)) throw Error('Duplicate proposal path.');
      seen.add(edit.path);
      if ((files[edit.path]?.sha256 ?? null) !== edit.beforeSha256)
        throw Error('Stale proposal: ' + edit.path);
    }
  } else {
    edits = [];
    for (const file of Object.keys(files).filter((f) => code.test(f)))
      edits.push({ path: file, content: await fs.readFile(await safePath(source, file), 'utf8') });
  }
  const records = [],
    blockers = [],
    additions = new Map();
  for (const edit of edits) {
    const ast = ts.createSourceFile(edit.path, edit.content, ts.ScriptTarget.Latest, true);
    for (const d of ast.parseDiagnostics ?? [])
      blockers.push(edit.path + ': ' + ts.flattenDiagnosticMessageText(d.messageText, ' '));
    const specs = new Set();
    function visit(n) {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier)
        specs.add(n.moduleSpecifier.text);
      if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference))
        specs.add(n.moduleReference.expression?.text);
      if (
        ts.isCallExpression(n) &&
        (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(n.expression) && n.expression.text === 'require'))
      ) {
        if (n.arguments.length === 1 && ts.isStringLiteralLike(n.arguments[0]))
          specs.add(n.arguments[0].text);
        else blockers.push(edit.path + ': computed import/require needs an explicit adapter.');
      }
      ts.forEachChild(n, visit);
    }
    visit(ast);
    const owner = [...layout.packages]
      .sort((a, b) => (a.dir === '.' ? 1 : b.dir === '.' ? -1 : b.dir.length - a.dir.length))
      .find((p) => p.dir === '.' || edit.path.startsWith(p.dir + '/'));
    const declared = groups(owner.manifest);
    for (const specifier of specs) {
      if (typeof specifier !== 'string') {
        blockers.push(edit.path + ': nonliteral module reference.');
        continue;
      }
      if (specifier.startsWith('.') || isBuiltin(specifier)) continue;
      const item = {
        importer: edit.path,
        specifier,
        manifest: owner.dir === '.' ? 'package.json' : owner.dir + '/package.json'
      };
      const valid =
        /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_][a-z0-9_./-]*$/.test(specifier) &&
        !specifier.split('/').some((p) => !p || p === '.' || p === '..');
      const name = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      item.name = name;
      if (Object.hasOwn(declared, name)) {
        item.kind = 'declared';
        item.range = declared[name];
      } else if (valid && catalog.has(name)) {
        const ranges = [...catalog.get(name)];
        if (ranges.length !== 1 || !registryRange(ranges[0])) {
          item.kind = 'blocked';
          blockers.push('Ambiguous or unsupported donor declaration for ' + name);
        } else {
          item.kind = 'add';
          item.range = ranges[0];
          additions.set(item.manifest + ':' + name, { manifest: item.manifest, name, range: item.range });
        }
      } else {
        // Never turn an unknown alias/private name into a public registry request.
        item.kind = 'unresolved';
        blockers.push(
          `${specifier} in ${edit.path}: no package declaration. Supply --dependency-source with a reviewed declaration, or resolve this framework alias before setup.`
        );
      }
      records.push(item);
    }
  }
  if (records.length > 1000) throw Error('Import discovery exceeds 1000 pairs; narrow the proposal.');
  return {
    status: blockers.length ? 'blocked' : 'ready',
    source,
    dependencySource: dependencySource ?? null,
    proposalSha256,
    records,
    additions: [...additions.values()],
    blockers,
    limitations: [
      'Literal JS/TS imports only; discovery does not prove installed exports or runtime behavior.',
      'Unknown names are never guessed from the public registry. Proposed code is inspected, not applied.'
    ]
  };
}
