'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { contrast, pyRound, alpha } = require('./color');
const { NEUTRAL, PALETTE_KEYS, buildTheme, contrastFailures } = require('./theme');

const albums = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'albums.json'), 'utf8')).albums;
const palettes = [
  ...albums.flatMap((a) => ['light', 'dark'].map((mode) => ({ name: `${a.slug}-${mode}`, mode, palette: a[mode] }))),
  ...['light', 'dark'].map((mode) => ({ name: `neutral-${mode}`, mode, palette: NEUTRAL[mode] })),
];

test('pyRound 与 Python round 一致（.5 取偶）', () => {
  assert.deepStrictEqual([0.5, 1.5, 2.5, 76.5, 76.4, 76.6].map(pyRound), [0, 2, 2, 76, 76, 77]);
  assert.strictEqual(alpha('#123456', 0.3), '#1234564c');
});

test('内置与中性配色：17 个 key 齐全、对比度达标', () => {
  for (const { name, palette } of palettes) {
    assert.deepStrictEqual(Object.keys(palette).sort(), [...PALETTE_KEYS].sort(), name);
    assert.deepStrictEqual(contrastFailures(palette), [], name);
  }
});

test('终端彩色、括号色、Error Lens 在背景上看得清', () => {
  for (const { name, mode, palette } of palettes) {
    const { colors } = buildTheme(palette, mode, name);
    for (const hue of ['Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan']) {
      for (const key of [`terminal.ansi${hue}`, `terminal.ansiBright${hue}`]) {
        assert.ok(contrast(colors[key], palette.bg) >= 4.5, `${name} ${key} ${colors[key]}`);
      }
    }
    for (let i = 1; i <= 6; i++) {
      const key = `editorBracketHighlight.foreground${i}`;
      assert.ok(contrast(colors[key], palette.bg) >= 3, `${name} ${key}`);
    }
    for (const kind of ['error', 'warning', 'info']) {
      assert.ok(contrast(colors[`errorLens.${kind}Foreground`], palette.bg) >= 4.5, `${name} ${kind}`);
    }
    assert.ok(Object.values(colors).every((c) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(c)), `${name} 颜色格式`);
  }
});

test('生成的主题文件与 buildTheme 输出一致（构建产物没过期）', () => {
  for (const album of albums) {
    for (const mode of ['light', 'dark']) {
      const file = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'themes', `${album.slug}-${mode}.json`), 'utf8'));
      assert.deepStrictEqual(file, buildTheme(album[mode], mode, file.name), `${album.slug}-${mode}`);
    }
  }
});
