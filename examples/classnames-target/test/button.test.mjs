import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buttonModel, classNames } from '../src/button.mjs';

test('button props keep label, tag, disabled state and base class', () => {
  assert.deepEqual(buttonModel({ label: 'Save', disabled: true, className: 'primary' }), {
    tag: 'button', label: 'Save', disabled: true, className: 'button primary'
  });
});
test('default button is enabled and string class names retain order', () => {
  assert.equal(buttonModel({ label: 'Next' }).disabled, false);
  assert.equal(buttonModel({ label: 'Next' }).className, 'button');
  assert.equal(classNames('a', '', 'b'), 'a b');
});
