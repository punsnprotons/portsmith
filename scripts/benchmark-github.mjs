// Explicitly authorized, local real-repository benchmark. See docs/benchmark-github.md.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { prepare, autoAdapt } from '../src/index.mjs';
import { inventory, saveJson, readJson } from '../src/platform/files.mjs';
const { values } = parseArgs({
  options: {
    case: { type: 'string' },
    mode: { type: 'string', default: 'prepare' },
    run: { type: 'string' },
    target: { type: 'string' }
  }
});
const base = path.resolve('.portsmith/github-bench');
const name = values.case;
if (!['it-tools', 'todomvc-es6'].includes(name)) throw new Error('--case it-tools|todomvc-es6 is required');
if (!['prepare', 'run', 'warmup'].includes(values.mode))
  throw new Error('--mode prepare|run|warmup is required');
if (values.mode === 'run') {
  const setup = await readJson(path.join(base, `${values.case}-latest.json`));
  const result = await autoAdapt(values.run ?? setup.run, {
    config: setup.config,
    allowModel: true,
    allowExecution: true,
    maxAttempts: 3,
    timeoutMs: 120000
  });
  await saveJson(path.join(setup.folder, 'result.json'), result);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'verified-for-contract') process.exitCode = 1;
  process.exit(process.exitCode ?? 0);
}
const target = values.target ? path.resolve(values.target) : path.join(base, 'targets', name);
const source = path.join(base, 'repos', name === 'it-tools' ? 'pretty-bytes' : 'escape-html');
if (values.mode === 'warmup') {
  if (name !== 'it-tools')
    throw new Error('Warmup only applies to IT-Tools generated component declarations.');
  const { startApp } = await import('../src/providers/browser/server.mjs');
  const { runProcess } = await import('../src/platform/process.mjs');
  const build = await runProcess('npm', ['run', 'build'], { cwd: target, timeoutMs: 120000 });
  await saveJson(path.join(base, 'it-tools-setup-build.json'), build);
  if (build.exitCode !== 0 || build.reason)
    throw new Error('Upstream setup build failed; see it-tools-setup-build.json');
  const { chromium } = await import('playwright');
  const app = await startApp(target, {
    page: 'text-statistics',
    server: {
      command: process.execPath,
      args: ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '{port}', '--strictPort']
    }
  });
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(app.origin + '/text-statistics', { timeout: 60000 });
    await page.locator('textarea[placeholder="Your text..."]').fill('warmup', { timeout: 30000 });
  } finally {
    await browser?.close();
    await app.close();
  }
  console.log('Completed upstream component generation before contract freeze.');
  process.exit(0);
}
const fill = (selector, value) => ({ action: 'fill', selector, value });
const text = (selector, expected) => ({ kind: 'text', selector, expected });
const count = (selector, expected) => ({ kind: 'count', selector, expected });
const input = 'textarea[placeholder="Your text..."]';
const stat = (label) =>
  `.n-statistic:has(.n-statistic__label:text-is("${label}")) .n-statistic-value__content`;
let contract, contextFiles;
if (name === 'it-tools') {
  const samples = [
    [0, '0 B'],
    [1, '1 B'],
    [1000, '1 kB'],
    [1024, '1.02 kB'],
    [1337, '1.34 kB'],
    [-1500, '-1.5 kB'],
    [1e6, '1 MB'],
    [0.5, '0.5 B']
  ];
  contract = {
    version: 1,
    source: { module: 'index.js', export: 'default' },
    target: { module: 'src/utils/convert.ts', export: 'formatBytes' },
    cases: [
      ...samples.map(([bytes, expected]) => ({
        name: `SI byte format ${bytes}`,
        sourceArgs: [bytes],
        targetArgs: [bytes],
        expected
      })),
      ...[
        [0, '1 kB'],
        [1, '1.3 kB'],
        [2, '1.33 kB']
      ].map(([digits, expected]) => ({
        name: `Explicit fractional precision ${digits}`,
        sourceArgs: [1337, { maximumFractionDigits: digits }],
        targetArgs: [1337, digits],
        expected
      }))
    ],
    regression: {
      command: process.execPath,
      args: [
        'node_modules/vitest/vitest.mjs',
        'run',
        '--environment=jsdom',
        ...Object.keys(await inventory(target)).filter((p) => p.endsWith('.test.ts'))
      ]
    },
    browser: {
      page: 'text-statistics',
      server: {
        command: process.execPath,
        args: ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '{port}', '--strictPort']
      },
      actionTimeoutMs: 10000,
      cases: [
        {
          name: 'SI kilobytes in actual text-statistics screen',
          steps: [fill(input, 'x'.repeat(1000))],
          assertions: [text(stat('Byte size'), '1 kB')]
        },
        {
          name: 'Unicode byte count in actual screen',
          steps: [fill(input, '😀'.repeat(250))],
          assertions: [text(stat('Byte size'), '1 kB'), text(stat('Character count'), '500')]
        },
        { name: 'Empty text byte format', steps: [], assertions: [text(stat('Byte size'), '0 B')] }
      ],
      regression: [
        {
          name: 'Existing counts',
          steps: [fill(input, 'hello world\nnext line')],
          assertions: [
            text(stat('Character count'), '21'),
            text(stat('Word count'), '4'),
            text(stat('Line count'), '2')
          ]
        },
        {
          name: 'Clear resets counts',
          steps: [fill(input, 'hello'), fill(input, '')],
          assertions: [
            text(stat('Character count'), '0'),
            text(stat('Word count'), '0'),
            text(stat('Line count'), '0')
          ]
        }
      ]
    }
  };
  contextFiles = [
    'src/utils/convert.ts',
    'src/tools/text-statistics/text-statistics.vue',
    'src/tools/text-statistics/text-statistics.service.ts',
    'src/tools/pdf-signature-checker/pdf-signature-checker.vue'
  ];
} else {
  // Frozen observation bridge: exposes the original renderer's label HTML to the
  // function runner. It contains no replacement escaping and is protected as a test.
  await fs.mkdir(path.join(target, 'test/public'), { recursive: true });
  await fs.copyFile(path.join(base, 'repos/todomvc/learn.json'), path.join(target, 'test/public/learn.json'));
  await fs.copyFile(path.join(base, 'repos/todomvc/license.md'), path.join(target, 'LICENSE'));
  await fs.copyFile(
    path.join(target, 'node_modules/todomvc-common/base.js'),
    path.join(target, 'test/public/base.js')
  );
  await fs.writeFile(
    path.join(target, 'test/portsmith.webpack.cjs'),
    `const path=require('node:path');
const config=require('../webpack.dev.js');
module.exports={...config,devServer:{...config.devServer,static:{directory:path.resolve(__dirname,'public')},open:false,hot:false,liveReload:false,client:false}};
`
  );
  await fs.writeFile(
    path.join(target, 'test/portsmith-boundary.mjs'),
    `import Template from '../src/template.js';\nexport function renderTitle(title) { return new Template().show([{id:1,title,completed:false}]).match(/<label>([\\s\\S]*?)<\\/label>/)[1]; }\n`
  );
  await fs.writeFile(
    path.join(target, 'test/portsmith-regression.test.mjs'),
    `import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport Template from '../src/template.js';\nconst t=new Template();\ntest('singular and plural counts',()=>{assert.equal(t.itemCounter(1),'<strong>1</strong> item left');assert.equal(t.itemCounter(2),'<strong>2</strong> items left');assert.equal(t.itemCounter(0),'<strong>0</strong> items left');});\ntest('clear completed visibility',()=>{assert.equal(t.clearCompletedButton(0),'');assert.equal(t.clearCompletedButton(2),'Clear completed');});\ntest('ordinary titles and completed state',()=>{const html=t.show([{id:7,title:'Milk',completed:true}]);assert.match(html,/<label>Milk<\\/label>/);assert.match(html,/class="completed"/);assert.match(html,/type="checkbox" checked/);});\n`
  );
  const samples = [
    ['Milk', 'Milk'],
    ["'face", '&#39;face'],
    ['`A', '`A'],
    ['<script>', '&lt;script&gt;'],
    ['a & b', 'a &amp; b'],
    ['"hi"', '&quot;hi&quot;'],
    ['', '']
  ];
  const todo = '.new-todo',
    add = (value) => [fill(todo, value), { action: 'press', selector: todo, key: 'Enter' }];
  contract = {
    version: 1,
    source: { module: 'index.js', export: 'default' },
    target: { module: 'test/portsmith-boundary.mjs', export: 'renderTitle' },
    cases: samples.map(([title, expected], i) => ({
      name: `Escaped title ${i}`,
      sourceArgs: [title],
      targetArgs: [title],
      expected
    })),
    regression: { command: process.execPath, args: ['--test', 'test/portsmith-regression.test.mjs'] },
    browser: {
      page: 'index.html',
      server: {
        command: process.execPath,
        args: [
          'node_modules/webpack-cli/bin/cli.js',
          'serve',
          '--config',
          'test/portsmith.webpack.cjs',
          '--host',
          '127.0.0.1',
          '--port',
          '{port}'
        ]
      },
      actionTimeoutMs: 5000,
      cases: [
        {
          name: 'Apostrophe followed by hex letters',
          steps: add("'face"),
          assertions: [text('.todo-list label', "'face")]
        },
        {
          name: 'Backtick followed by hex digit',
          steps: add('`A'),
          assertions: [text('.todo-list label', '`A')]
        },
        {
          name: 'Markup stays text',
          steps: add('<img src=x onerror=alert(1)>'),
          assertions: [text('.todo-list label', '<img src=x onerror=alert(1)>'), count('.todo-list img', 0)]
        }
      ],
      regression: [
        {
          name: 'Add, complete, filter, clear',
          steps: [
            ...add('Buy milk'),
            ...add('Walk dog'),
            { action: 'check', selector: '.todo-list li:has-text("Buy milk") .toggle', checked: true },
            { action: 'click', selector: '.filters a[href="#/completed"]' }
          ],
          assertions: [
            count('.todo-list li', 1),
            text('.todo-list label', 'Buy milk'),
            text('.todo-count', '1 item left')
          ]
        },
        {
          name: 'Clear completed preserves active todo',
          steps: [
            ...add('Buy milk'),
            ...add('Walk dog'),
            { action: 'check', selector: '.todo-list li:has-text("Buy milk") .toggle', checked: true },
            { action: 'click', selector: '.clear-completed' }
          ],
          assertions: [count('.todo-list li', 1), text('.todo-list label', 'Walk dog')]
        }
      ]
    }
  };
  contextFiles = ['src/template.js', 'src/view.js', 'src/controller.js', 'src/index.html'];
}
if (name === 'it-tools')
  contract.checks = [
    { name: 'Upstream TypeScript check', command: 'npm', args: ['run', 'typecheck'] },
    { name: 'Upstream production build', command: 'npm', args: ['run', 'build'] }
  ];
else contract.checks = [{ name: 'Upstream production build', command: 'npm', args: ['run', 'build'] }];
if (values.mode === 'prepare') {
  const folder = await fs.mkdtemp(path.join(base, `${name}-`));
  const contractFile = path.join(folder, 'contract-input.json');
  await saveJson(contractFile, contract);
  const options = {
    source,
    target,
    entry: 'index.js',
    mount: 'src/features/' + (name === 'it-tools' ? 'pretty-bytes' : 'escape-html'),
    contract: contractFile,
    out: path.join(folder, 'run')
  };
  await prepare(options);
  for (const side of ['baseline', 'candidate'])
    await fs.cp(
      await fs.realpath(path.join(target, 'node_modules')),
      path.join(options.out, side, 'node_modules'),
      {
        recursive: true,
        verbatimSymlinks: true,
        mode: constants.COPYFILE_FICLONE
      }
    );
  const config = { ...(await readJson('portsmith.model.json')), contextFiles, maxContextBytes: 300000 };
  await saveJson(path.join(folder, 'model.json'), config);
  await saveJson(path.join(base, `${name}-latest.json`), {
    folder,
    run: options.out,
    config: path.join(folder, 'model.json')
  });
  console.log(options.out);
} else throw new Error('Unknown --mode');
