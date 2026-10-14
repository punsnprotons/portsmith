import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { loadAliases, aliasTarget, relativeAlias } from '../javascript/aliases.mjs';
import { inside, safePath } from '../../platform/files.mjs';
let root, aliases;
export async function initialize(data) {
  root = await fs.realpath(data.root);
  aliases = await loadAliases(root);
}
export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : null;
  if (
    !parent ||
    path.resolve(parent) === root ||
    !inside(root, parent) ||
    parent.split(path.sep).includes('node_modules')
  )
    return nextResolve(specifier, context);
  const mapped = aliasTarget(specifier, aliases, path.relative(root, parent).split(path.sep).join('/'));
  if (!mapped) {
    try {
      return await nextResolve(specifier, context);
    } catch (error) {
      if (
        !specifier.startsWith('.') ||
        !['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(error.code)
      )
        throw error;
    }
  }
  const lookup = mapped
    ? relativeAlias(path.relative(root, parent).split(path.sep).join('/'), mapped)
    : specifier;
  // Prefer a real runtime file over a sibling declaration, matching static analysis.
  try {
    const url = mapped ? pathToFileURL(path.join(root, mapped)).href : specifier;
    return await nextResolve(url, context);
  } catch (error) {
    if (!['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(error.code)) throw error;
  }
  const resolved = ts.resolveModuleName(
    lookup,
    parent,
    { allowJs: true, moduleResolution: ts.ModuleResolutionKind.Bundler },
    ts.sys
  ).resolvedModule;
  if (
    !resolved ||
    !inside(root, path.resolve(resolved.resolvedFileName)) ||
    /\.d\.[cm]?ts$/.test(resolved.resolvedFileName)
  )
    throw Error('Unresolved or escaping runtime import: ' + specifier);
  const local = path.relative(root, resolved.resolvedFileName).split(path.sep).join('/');
  const file = await safePath(root, local);
  return nextResolve(pathToFileURL(file).href, context);
}
