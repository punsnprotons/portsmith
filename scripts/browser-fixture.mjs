import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixture.mjs';
import { readJson, saveJson } from '../src/platform/files.mjs';
export async function browserFixture(root) {
  const options = await fixture(root);
  await fs.writeFile(
    path.join(options.target, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Catalog</title>
<style>
:root{color-scheme:light;font-family:system-ui,sans-serif;color:#182b3a;background:#fff}*{box-sizing:border-box}body{margin:0;padding:28px}main{max-width:600px;margin:auto}.eyebrow{font:11px ui-monospace,monospace;letter-spacing:.13em;text-transform:uppercase;color:#526775}h1{font-size:32px;letter-spacing:-.04em;margin:10px 0}.intro{color:#526775;font-size:14px;line-height:1.6;margin:0 0 24px}label{display:block;font-size:13px;font-weight:600}.search{display:flex;gap:10px;margin-top:8px}input{font:inherit;min-width:0;width:100%;padding:12px;border:1px solid #b4c1c9;border-radius:6px}button{font:inherit;font-size:13px;background:#edf2f5;color:#182b3a;border:1px solid #b4c1c9;border-radius:6px;padding:10px 16px;cursor:pointer}input:focus-visible,button:focus-visible{outline:3px solid #2864d7;outline-offset:3px}ul{list-style:none;padding:0;margin:22px 0}li{padding:18px 0;border-bottom:1px solid #dde4e9;font-size:16px}li:before{content:'↳';color:#8b4c2c;margin-right:12px}.note{font-size:12px;color:#526775;margin-top:24px}@media(max-width:400px){body{padding:20px}h1{font-size:28px}.search{gap:6px}button{padding:10px}}
</style></head><body><main>
<p class="eyebrow">The destination app</p><h1>Catalog</h1><p class="intro">Three products. One search box.</p><label for="query">Search products</label><div class="search"><input id="query" data-testid="query" placeholder="Try TEA or cafe" autocomplete="off"><button data-testid="reset">Reset</button></div><ul data-testid="products" aria-live="polite" aria-label="Products"></ul><p class="note">Included Portsmith example · local data only</p></main>
<script type="module">
import {searchCatalog} from './src/catalog.mjs';
const input=document.querySelector('[data-testid="query"]'),list=document.querySelector('[data-testid="products"]');
function render(){list.replaceChildren(...searchCatalog(input.value).map(product=>{const li=document.createElement('li');li.textContent=product.name;return li;}));}
input.addEventListener('input',render);document.querySelector('[data-testid="reset"]').addEventListener('click',()=>{input.value='';render();});render();
</script></body></html>`
  );
  const contract = await readJson(options.contract);
  contract.browser = {
    page: 'index.html',
    actionTimeoutMs: 300,
    cases: [
      {
        name: 'search visible products',
        steps: [{ action: 'fill', selector: '[data-testid="query"]', value: 'TEA' }],
        assertions: [
          { kind: 'text', selector: '[data-testid="products"]', expected: 'Tea leaves' },
          { kind: 'count', selector: 'li', expected: 1 }
        ]
      },
      {
        name: 'accent search',
        steps: [{ action: 'fill', selector: '[data-testid="query"]', value: 'cafe' }],
        assertions: [{ kind: 'text', selector: 'li', expected: 'Café beans' }]
      }
    ],
    regression: [
      {
        name: 'reset restores catalog',
        steps: [
          { action: 'fill', selector: '[data-testid="query"]', value: 'Tea' },
          { action: 'click', selector: '[data-testid="reset"]' }
        ],
        assertions: [
          { kind: 'count', selector: 'li', expected: 3 },
          { kind: 'value', selector: '[data-testid="query"]', expected: '' },
          { kind: 'visible', selector: 'h1', expected: true }
        ]
      }
    ]
  };
  await saveJson(options.contract, contract);
  return options;
}
