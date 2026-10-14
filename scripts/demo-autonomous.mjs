import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { browserFixture } from './browser-fixture.mjs';
import { project } from './fixture.mjs';
import { prepare, autoAdapt } from '../src/index.mjs';
const { values } = parseArgs({
  options: {
    config: { type: 'string', default: 'portsmith.model.json' },
    'broken-wiring': { type: 'boolean' }
  }
});
await fs.mkdir(path.join(project, '.portsmith'), { recursive: true });
const root = await fs.mkdtemp(path.join(project, '.portsmith', 'autonomous-demo-'));
const options = await browserFixture(root);
if (values['broken-wiring']) {
  const page = path.join(options.target, 'index.html');
  await fs.writeFile(
    page,
    (await fs.readFile(page, 'utf8')).replace("input.addEventListener('input',render);", '')
  );
}
await prepare(options);
console.log('Prepared a browser catalog transfer. Asking the model to integrate it.');
const result = await autoAdapt(options.out, {
  config: path.resolve(values.config),
  allowExecution: true,
  allowModel: true,
  maxAttempts: 3,
  timeoutMs: 30000
});
console.log(JSON.stringify(result, null, 2));
if (result.status !== 'verified-for-contract') process.exitCode = 1;
