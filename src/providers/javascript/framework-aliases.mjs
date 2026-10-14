// Read selected configuration syntax as data. No imports, plugins or config functions execute.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isBuiltin } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { safePath, inside, relativeFile, hash } from '../../platform/files.mjs';
export async function frameworkAliases(root) {
  const mappings = [],
    files = [],
    providers = [];
  async function readConfig(kind) {
    const found = [];
    for (const ext of ['js', 'mjs', 'ts', 'mts', 'cjs', 'cts']) {
      const rel = kind + '.config.' + ext;
      try {
        await fs.lstat(path.join(root, rel));
        found.push(rel);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    if (found.length > 1)
      throw Error('Multiple ' + kind + ' configs; select explicit aliases in portsmith.aliases.json.');
    if (!found.length) return null;
    const rel = found[0],
      filename = await safePath(root, rel),
      stat = await fs.stat(filename);
    if (stat.size > 100000) throw Error('Framework alias config exceeds 100 KB.');
    const text = await fs.readFile(filename, 'utf8'),
      ast = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
    if (ast.parseDiagnostics.length) throw Error('Invalid framework alias configuration: ' + rel);
    files.push({ path: rel, sha256: hash(text) });
    const vars = new Map(),
      imports = new Map(),
      declared = new Set();
    let exported;
    for (const statement of ast.statements) {
      if (ts.isVariableStatement(statement))
        for (const d of statement.declarationList.declarations)
          if (ts.isIdentifier(d.name)) declared.add(d.name.text);
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name)
        declared.add(statement.name.text);
      if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const)
        for (const d of statement.declarationList.declarations)
          if (ts.isIdentifier(d.name)) vars.set(d.name.text, d.initializer);
      if (ts.isImportDeclaration(statement)) {
        const source = statement.moduleSpecifier.text,
          c = statement.importClause;
        if (c?.name) imports.set(c.name.text, { source, name: 'default' });
        if (c?.namedBindings) {
          if (ts.isNamespaceImport(c.namedBindings))
            imports.set(c.namedBindings.name.text, { source, name: '*' });
          else
            for (const e of c.namedBindings.elements)
              imports.set(e.name.text, { source, name: e.propertyName?.text ?? e.name.text });
        }
      }
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) exported = statement.expression;
    }
    const mutated = new Set();
    function rootName(node) {
      while (
        node &&
        (ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node) ||
          ts.isParenthesizedExpression(node))
      )
        node = node.expression;
      return node && ts.isIdentifier(node) ? node.text : undefined;
    }
    function writes(node) {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      )
        mutated.add(rootName(node.left));
      if (
        (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
      )
        mutated.add(rootName(node.operand));
      if (ts.isDeleteExpression(node)) mutated.add(rootName(node.expression));
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(ast) === 'Object' &&
        ['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf'].includes(node.expression.name.text)
      )
        mutated.add(rootName(node.arguments[0]));
      ts.forEachChild(node, writes);
    }
    writes(ast);
    function unwrap(node, seen = new Set()) {
      if (!node) throw Error('Missing static framework alias expression in ' + rel);
      if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
        return unwrap(node.expression, seen);
      if (ts.isIdentifier(node) && vars.has(node.text)) {
        if (seen.has(node.text)) throw Error('Cyclic framework config constant.');
        if (mutated.has(node.text)) throw Error('Mutated framework config requires an explicit alias map.');
        return unwrap(vars.get(node.text), new Set([...seen, node.text]));
      }
      return node;
    }
    const imported = (node, name, sources) => {
      if (ts.isIdentifier(node)) {
        const i = imports.get(node.text);
        return i && i.name === name && sources.includes(i.source);
      }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
        const i = imports.get(node.expression.text);
        return (
          i && ['*', 'default'].includes(i.name) && sources.includes(i.source) && node.name.text === name
        );
      }
      return false;
    };
    let object = unwrap(exported);
    if (
      ts.isCallExpression(object) &&
      imported(object.expression, 'defineConfig', ['vite', 'vitest/config']) &&
      object.arguments.length === 1
    )
      object = unwrap(object.arguments[0]);
    if (!ts.isObjectLiteralExpression(object))
      throw Error('Framework config must export a static object or defineConfig(object): ' + rel);
    function property(container, key) {
      container = unwrap(container);
      if (
        (ts.isIdentifier(container) && container.text === 'undefined') ||
        container.kind === ts.SyntaxKind.NullKeyword
      )
        return undefined;
      if (ts.isConditionalExpression(container)) {
        const a = property(container.whenTrue, key),
          b = property(container.whenFalse, key);
        if (a?.getText(ast) === b?.getText(ast)) return a;
        throw Error('Conditional framework aliases differ; provide an explicit mapping.');
      }
      if (!ts.isObjectLiteralExpression(container))
        throw Error('Dynamic framework ' + key + ' configuration in ' + rel);
      let result;
      for (const p of container.properties) {
        if (ts.isSpreadAssignment(p) || (p.name && ts.isComputedPropertyName(p.name)))
          throw Error('Computed/spread framework alias configuration requires an explicit map.');
        const name = p.name?.text;
        if (name === key) {
          if (result) throw Error('Duplicate config property: ' + key);
          if (ts.isPropertyAssignment(p)) result = p.initializer;
          else if (ts.isShorthandPropertyAssignment(p)) result = p.name;
          else throw Error('Dynamic config property: ' + key);
        }
      }
      return result;
    }
    function expression(node) {
      node = unwrap(node);
      if (ts.isStringLiteralLike(node)) return node.text;
      if (
        ts.isIdentifier(node) &&
        node.text === '__dirname' &&
        !declared.has('__dirname') &&
        !imports.has('__dirname')
      )
        return path.dirname(filename);
      if (
        ts.isNewExpression(node) &&
        node.arguments?.length === 2 &&
        ((ts.isIdentifier(node.expression) &&
          node.expression.text === 'URL' &&
          !declared.has('URL') &&
          !imports.has('URL')) ||
          imported(node.expression, 'URL', ['node:url', 'url'])) &&
        node.arguments[1].getText(ast) === 'import.meta.url'
      ) {
        const value = expression(node.arguments[0]);
        if (typeof value !== 'string') throw Error('URL path must be a literal string.');
        const url = new URL(value, pathToFileURL(filename));
        if (url.search || url.hash) throw Error('Alias URL must not contain query or fragment.');
        return { url: fileURLToPath(url) };
      }
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'pathname') {
        const v = expression(node.expression);
        if (v?.url) return v.url;
      }
      if (ts.isCallExpression(node)) {
        if (imported(node.expression, 'fileURLToPath', ['node:url', 'url']) && node.arguments.length === 1) {
          const v = expression(node.arguments[0]);
          if (v?.url) return v.url;
        }
        if (imported(node.expression, 'resolve', ['node:path', 'path']))
          return path.resolve(
            path.dirname(filename),
            ...node.arguments.map((a) => {
              const v = expression(a);
              if (typeof v !== 'string') throw Error('Unsupported path expression.');
              return v;
            })
          );
      }
      throw Error(
        'Dynamic framework alias target in ' + rel + '; provide a literal/path.resolve/fileURLToPath mapping.'
      );
    }
    function add(pattern, target, { prefix = false } = {}) {
      if (
        !pattern ||
        pattern.startsWith('.') ||
        pattern.startsWith('/') ||
        pattern.includes('\\') ||
        isBuiltin(pattern)
      )
        throw Error('Unsupported framework alias name.');
      if (typeof target !== 'string') throw Error('Framework alias target must resolve to a path.');
      const wildcard = pattern.endsWith('/*');
      if (pattern.includes('*') && !wildcard)
        throw Error('Only trailing framework alias wildcards are supported.');
      if (wildcard !== target.endsWith('/*')) throw Error('Framework alias wildcard mismatch.');
      if (kind === 'vite' && !path.isAbsolute(target))
        throw Error(
          'Vite relative alias targets do not resolve as repository paths; use an absolute path expression.'
        );
      const absolute = path.resolve(root, target.replace(/\/\*$/, ''));
      if (!inside(root, absolute)) throw Error('Framework alias escapes repository.');
      const local = path.relative(root, absolute).split(path.sep).join('/');
      if (local) relativeFile(local);
      mappings.push({ pattern, target: local + (wildcard ? (local ? '/*' : '*') : '') });
      if (prefix && !wildcard) mappings.push({ pattern: pattern + '/*', target: local ? local + '/*' : '*' });
    }
    const section =
      property(object, kind === 'vite' ? 'resolve' : 'kit') ??
      (kind === 'svelte' ? ts.factory.createObjectLiteralExpression() : undefined);
    if (!section) return { kind };
    const aliases = property(section, 'alias');
    if (aliases) {
      const obj = unwrap(aliases);
      if (!ts.isObjectLiteralExpression(obj))
        throw Error(
          'Framework aliases must be a static object; regex/array mappings require an explicit map.'
        );
      for (const p of obj.properties) {
        if (!ts.isPropertyAssignment(p) || !p.name || ts.isComputedPropertyName(p.name))
          throw Error('Unsupported framework alias property.');
        add(p.name.text, expression(p.initializer), { prefix: !p.name.text.endsWith('*') });
      }
    }
    if (kind === 'svelte') {
      const pkg = JSON.parse(await fs.readFile(await safePath(root, 'package.json'), 'utf8'));
      files.push({ path: 'package.json', sha256: hash(await fs.readFile(path.join(root, 'package.json'))) });
      const range = pkg.dependencies?.['@sveltejs/kit'] ?? pkg.devDependencies?.['@sveltejs/kit'];
      if (typeof range !== 'string' || !/^\^?2\./.test(range))
        throw Error('Automatic $lib aliases currently require a declared SvelteKit 2 version.');
      const configFiles = property(section, 'files'),
        lib = configFiles && property(configFiles, 'lib');
      if (!mappings.some((m) => m.pattern === '$lib'))
        add('$lib', lib ? expression(lib) : 'src/lib', { prefix: true });
    }
    providers.push(kind === 'svelte' ? 'sveltekit-2' : 'vite');
    return { kind };
  }
  await readConfig('vite');
  await readConfig('svelte');
  return { mappings, files, providers };
}
