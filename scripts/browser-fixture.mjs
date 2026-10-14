import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixture.mjs';
import { readJson, saveJson } from '../src/platform/files.mjs';
export async function browserFixture(root) {
  const options = await fixture(root);
  await fs.writeFile(
    path.join(options.target, 'index.html'),
    `<!doctype html><html><head><meta charset="utf-8"><title>Catalog</title></head><body>
<h1>Catalog</h1><label>Search products <input data-testid="query"></label><button data-testid="reset">Reset</button><ul data-testid="products"></ul>
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
