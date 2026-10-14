import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProduct, searchCatalog } from '../src/catalog.mjs';

test('product lookup preserves IDs and the unknown-product contract', () => {
  assert.deepEqual(getProduct(2), { id: 2, name: 'Tea leaves' });
  assert.equal(getProduct(99), null);
});
test('callers cannot mutate stored products through search results', () => {
  const results = searchCatalog('');
  results[0].name = 'changed';
  assert.equal(getProduct(1).name, 'Café beans');
  assert.equal(searchCatalog('').length, 3);
});
