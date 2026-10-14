import fs from 'node:fs/promises';
import path from 'node:path';
import { modelConfig } from '../providers/model/client.mjs';
import { json } from '../platform/files.mjs';

export async function init({ out, model, baseURL = 'https://api.openai.com/v1' }) {
  const config = modelConfig({ model, baseURL, apiKeyEnv: 'OPENAI_API_KEY' });
  out = path.resolve(out);
  // An existing directory, file or symlink is never replaced.
  await fs.mkdir(out, { mode: 0o700 });
  const files = {
    'portsmith.model.json': json(config),
    '.env.example': '# Copy to .env and add your key locally. Never commit .env.\nOPENAI_API_KEY=\n',
    '.gitignore': '.env\n.env.*\n!.env.example\n.portsmith/\n',
    'README.md':
      '# Portsmith workspace\n\nCopy `.env.example` to `.env` and add your key. The model ID must be available from your provider.\n\nRun from this directory:\n\n```sh\nnode --env-file=.env /path/to/portsmith/src/cli.mjs doctor --config portsmith.model.json --browser --human\nportsmith discover --source /path/to/repo --query search --human\nportsmith inspect --source /path/to/repo --entry selected/file.js --human\n```\n\nDoctor checks local readiness, not provider access. Review source and destination code, define a behavior contract, then plan and prepare a fresh transfer. Preview copied-repository dependencies with `portsmith dependencies --run DIR`, then explicitly install supported lockfiles with `portsmith install-deps --run DIR --allow-execution`. Run `portsmith COMMAND --help` for options.\n'
  };
  for (const [name, content] of Object.entries(files))
    await fs.writeFile(path.join(out, name), content, { flag: 'wx', mode: 0o600 });
  return {
    status: 'created',
    workspace: out,
    files: Object.keys(files),
    next: 'Copy .env.example to .env and add your key locally. Load it with node --env-file before running doctor --config portsmith.model.json --browser.'
  };
}
