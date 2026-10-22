'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveBackgroundOpacity, clampOpacity } = require('./background');

test('unset and null settings use more visible theme defaults', () => {
  assert.deepEqual(resolveBackgroundOpacity(), { dark: 0.30, light: 0.22 });
  assert.deepEqual(resolveBackgroundOpacity({
    backgroundOpacity: null, backgroundOpacityDark: null, backgroundOpacityLight: null,
  }), { dark: 0.30, light: 0.22 });
});

test('shared opacity applies to both themes, with independent overrides', () => {
  assert.deepEqual(resolveBackgroundOpacity({ backgroundOpacity: 0.4 }), { dark: 0.4, light: 0.4 });
  assert.deepEqual(resolveBackgroundOpacity({
    backgroundOpacity: 0.4, backgroundOpacityDark: 0.5, backgroundOpacityLight: null,
  }), { dark: 0.5, light: 0.4 });
  assert.deepEqual(resolveBackgroundOpacity({
    backgroundOpacityDark: 0.35, backgroundOpacityLight: 0.15,
  }), { dark: 0.35, light: 0.15 });
});

test('finite numbers clamp to inclusive bounds', () => {
  for (const [input, expected] of [[-1, 0.05], [0, 0.05], [0.05, 0.05], [0.22, 0.22], [0.6, 0.6], [10, 0.6]]) {
    assert.equal(clampOpacity(input), expected);
  }
  assert.deepEqual(resolveBackgroundOpacity({
    backgroundOpacity: 2, backgroundOpacityLight: -2,
  }), { dark: 0.6, light: 0.05 });
});

test('invalid values derive without coercion or unsafe CSS values', () => {
  for (const value of [undefined, null, NaN, Infinity, -Infinity, '0.4', '', true, {}, [], '0; color:red']) {
    assert.equal(clampOpacity(value), undefined);
    assert.deepEqual(resolveBackgroundOpacity({ backgroundOpacity: value }), { dark: 0.30, light: 0.22 });
    assert.deepEqual(resolveBackgroundOpacity({
      backgroundOpacity: 0.25, backgroundOpacityDark: value, backgroundOpacityLight: value,
    }), { dark: 0.25, light: 0.25 });
  }
});

test('manifest exposes nullable, bounded opacity settings', () => {
  const pkg = require('../package.json');
  for (const key of ['backgroundOpacity', 'backgroundOpacityDark', 'backgroundOpacityLight']) {
    const schema = pkg.contributes.configuration.properties[`albumSkins.${key}`];
    assert.deepEqual(schema.type, ['number', 'null']);
    assert.equal(schema.default, null);
    assert.equal(schema.minimum, 0.05);
    assert.equal(schema.maximum, 0.6);
  }
});
