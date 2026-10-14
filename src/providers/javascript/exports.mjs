import ts from 'typescript';

// Syntax observations help select a contract boundary; they never prove runtime exports.
export function exportObservations(ast, file) {
  const bindings = new Map();
  const names = (name) =>
    ts.isIdentifier(name)
      ? [name.text]
      : (name.elements?.flatMap((e) => (e.name ? names(e.name) : [])) ?? []);
  for (const node of ast.statements) {
    if (node.name && ts.isIdentifier(node.name)) bindings.set(node.name.text, node);
    if (ts.isVariableStatement(node))
      for (const d of node.declarationList.declarations)
        for (const name of names(d.name)) bindings.set(name, d.initializer);
  }
  const result = [];
  function add(name, node, value, { typeOnly = false, from = null, syntax = 'esm' } = {}) {
    typeOnly ||= ast.isDeclarationFile;
    const location = ast.getLineAndCharacterOfPosition(node.getStart(ast));
    const binding = value && ts.isIdentifier(value) ? bindings.get(value.text) : value;
    result.push({
      path: file,
      name,
      line: location.line + 1,
      column: location.character + 1,
      syntax,
      typeOnly,
      from,
      callable:
        !typeOnly &&
        binding &&
        (ts.isFunctionDeclaration(binding) || ts.isFunctionExpression(binding) || ts.isArrowFunction(binding))
          ? 'function-syntax'
          : 'unknown'
    });
  }
  const property = (node) =>
    ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
        ? node.argumentExpression.text
        : null;
  const moduleExports = (node) =>
    node &&
    (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'module' &&
    property(node) === 'exports' &&
    !bindings.has('module');
  for (const node of ast.statements) {
    const exported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (exported) {
      if (ts.isVariableStatement(node))
        for (const d of node.declarationList.declarations)
          for (const name of names(d.name)) add(name, d, d.initializer);
      else if (isDefault || node.name)
        add(isDefault ? 'default' : node.name.text, node, node, {
          typeOnly: ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)
        });
    }
    if (ts.isExportAssignment(node)) add(node.isExportEquals ? 'export=' : 'default', node, node.expression);
    if (ts.isExportDeclaration(node)) {
      const from = node.moduleSpecifier?.text ?? null;
      if (node.exportClause && ts.isNamedExports(node.exportClause))
        for (const e of node.exportClause.elements)
          add(e.name.text, e, from ? null : (e.propertyName ?? e.name), {
            typeOnly: node.isTypeOnly || e.isTypeOnly,
            from
          });
      else add(node.exportClause?.name.text ?? '*', node, null, { typeOnly: node.isTypeOnly, from });
    }
    if (!ts.isExpressionStatement(node) || !ts.isBinaryExpression(node.expression)) continue;
    const e = node.expression;
    if (e.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
    if (moduleExports(e.left)) add('default', node, e.right, { syntax: 'commonjs-assignment' });
    else if (ts.isPropertyAccessExpression(e.left) || ts.isElementAccessExpression(e.left)) {
      const object = e.left.expression;
      if (
        moduleExports(object) ||
        (ts.isIdentifier(object) && object.text === 'exports' && !bindings.has('exports'))
      ) {
        const name = property(e.left);
        if (name !== null) add(name, node, e.right, { syntax: 'commonjs-assignment' });
      }
    }
  }
  return result;
}
