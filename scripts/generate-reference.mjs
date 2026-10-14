import fs from 'node:fs/promises';
import { commands } from '../src/contracts/commands.mjs';
const content = '# Command reference\n\nGenerated from `src/contracts/commands.mjs`. Run `npm run docs:generate` after changing public contracts.\n\n' +
  '| CLI | MCP tool | Effect | Description |\n| --- | --- | --- | --- |\n' +
  Object.entries(commands).map(([name, c]) => `| \`${name}\` | \`${c.tool}\` | ${c.effects} | ${c.description} |`).join('\n') +
  '\n\nInspect exact inputs with `portsmith schema --command NAME`; `contract` and `proposal` schemas are also available.\n\nExecution commands require explicit authorization. MCP hides them unless the server starts with `--allow-execution`; each call must also set `allowExecution: true`.\n';
const file = new URL('../docs/commands.md', import.meta.url);
if (process.argv.includes('--check')) {
  if (await fs.readFile(file, 'utf8') !== content) throw new Error('Command reference is stale. Run npm run docs:generate.');
} else await fs.writeFile(file, content);
