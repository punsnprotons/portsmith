import fs from 'node:fs/promises';
import path from 'node:path';
import { analyze } from '../providers/javascript/analyze.mjs';
import { sourceModuleScopes } from '../providers/javascript/module-scopes.mjs';
import { safePath, readJson } from '../platform/files.mjs';

export async function planTransfer(input) {
  const analysis = await analyze(input);
  let manifest = {};
  try {
    manifest = await readJson(await safePath(analysis.target, 'package.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const entries = await fs.readdir(analysis.target);
  const packages = { ...manifest.devDependencies, ...manifest.dependencies };
  const frameworks = ['next', 'react', 'vue', 'svelte', 'express', 'fastify'].filter((name) =>
    Object.hasOwn(packages, name)
  );
  const files = analysis.files.map((file) => ({
    source: file.path,
    destination: `${analysis.mount}/${file.path}`,
    sha256: file.sha256
  }));
  const generatedFiles = (await sourceModuleScopes(analysis)).map((scope) => ({
    destination: `${analysis.mount}/${scope.path}`,
    purpose: 'Preserve source module format',
    content: scope.content
  }));
  const collisions = [];
  const destinations = [
    ...files,
    ...generatedFiles,
    ...analysis.license.files.map((file) => ({ destination: `${analysis.mount}/${file.path}` })),
    { destination: `${analysis.mount}/PORTSMITH_PROVENANCE.json` }
  ];
  for (const file of destinations) {
    const dest = await safePath(analysis.target, file.destination, { missing: true });
    try {
      await fs.lstat(dest);
      collisions.push(file.destination);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const blockers = [
    ...analysis.blockers,
    ...collisions.map((file) => `Destination file already exists: ${file}`)
  ];
  return {
    version: 1,
    status: blockers.length ? 'blocked' : 'ready-to-define-contract',
    source: analysis.source,
    target: analysis.target,
    entry: analysis.entry,
    mount: analysis.mount,
    destination: {
      packageName: manifest.name ?? null,
      moduleType: manifest.type ?? 'unspecified',
      frameworks,
      directories: entries.filter((name) => ['src', 'app', 'pages', 'lib', 'test', 'tests'].includes(name)),
      typescript: entries.includes('tsconfig.json'),
      scripts: manifest.scripts ?? {}
    },
    files,
    generatedFiles,
    exports: analysis.exports,
    dependencies: analysis.externals,
    aliasRewrites: analysis.aliases?.rewrites ?? [],
    license: analysis.license,
    blockers,
    steps: [
      {
        id: 'contract',
        state: 'required',
        action:
          'Enable runtime.aliases in the contract if alias support is selected. Select source and destination callable exports; declare expected behavior and explicit Node regression test files.'
      },
      {
        id: 'prepare',
        state: blockers.length ? 'blocked' : 'pending',
        action: 'Create a fresh run outside both repositories.'
      },
      {
        id: 'integrate',
        state: 'pending',
        action: 'Adapt imports and callers in the candidate to the destination conventions; preserve tests.'
      },
      {
        id: 'verify',
        state: 'pending',
        action:
          'Require source pass, a destination behavior gap, candidate pass and completed regression tests.'
      },
      { id: 'export', state: 'pending', action: 'Review a fresh verified patch before applying it.' }
    ],
    limitations: [
      ...analysis.limitations,
      'Framework names are manifest observations, not proof of framework compatibility. No adaptation edits are generated.'
    ]
  };
}
