// 色彩工具。从 v1 的 build.py 移植，取整和 HLS 换算刻意照搬 Python（round 是银行家舍入、
// colorsys 的算法和取模语义），保证内置 32 个主题的颜色和 v1 逐值相同。
'use strict';

/** Python 的 round()：恰好 .5 时取偶数。 */
function pyRound(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Python 的浮点取模：结果与除数同号。 */
function pyMod(a, b) {
  const r = a % b;
  return r !== 0 && (r < 0) !== (b < 0) ? r + b : r;
}

function rgb(color) {
  const hex = color.replace(/^#/, '');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

function hexify(channels) {
  return `#${channels.map((c) => pyRound(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function luminance(color) {
  const linear = rgb(color).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(first, second) {
  const [a, b] = [luminance(first), luminance(second)].sort((x, y) => x - y);
  return (b + 0.05) / (a + 0.05);
}

function mix(first, second, weight = 0.5) {
  const a = rgb(first);
  const b = rgb(second);
  return hexify(a.map((x, i) => x * (1 - weight) + b[i] * weight));
}

function alpha(color, value) {
  return `${color}${pyRound(value * 255).toString(16).padStart(2, '0')}`;
}

// colorsys.rgb_to_hls / hls_to_rgb（CPython 3.12）
function rgbToHls(r, g, b) {
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  const sumc = maxc + minc;
  const rangec = maxc - minc;
  const l = sumc / 2;
  if (minc === maxc) return [0, l, 0];
  const s = l <= 0.5 ? rangec / sumc : rangec / (2 - maxc - minc);
  const rc = (maxc - r) / rangec;
  const gc = (maxc - g) / rangec;
  const bc = (maxc - b) / rangec;
  let h;
  if (r === maxc) h = bc - gc;
  else if (g === maxc) h = 2 + rc - bc;
  else h = 4 + gc - rc;
  return [pyMod(h / 6, 1), l, s];
}

function hlsChannel(m1, m2, hue) {
  hue = pyMod(hue, 1);
  if (hue < 1 / 6) return m1 + (m2 - m1) * hue * 6;
  if (hue < 0.5) return m2;
  if (hue < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - hue) * 6;
  return m1;
}

function hlsToRgb(h, l, s) {
  if (s === 0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const m1 = 2 * l - m2;
  return [hlsChannel(m1, m2, h + 1 / 3), hlsChannel(m1, m2, h), hlsChannel(m1, m2, h - 1 / 3)];
}

/** 保持色相，只调明度直到对比度达标（浅底压暗、深底提亮）。 */
function readable(color, background, target) {
  let [h, lightness, s] = rgbToHls(...rgb(color));
  const step = luminance(background) > 0.5 ? -0.01 : 0.01;
  while (contrast(color, background) < target && lightness > 0 && lightness < 1) {
    lightness += step;
    color = hexify(hlsToRgb(h, lightness, s));
  }
  return color;
}

/** albums.json 里 bg-subtle 是 rgba()，VS Code 只认十六进制。 */
function rgbaToHex(value, background) {
  if (value.startsWith('#')) return value;
  const [r, g, b, a] = value.slice(value.indexOf('(') + 1, -1).split(',').map(Number);
  return mix(background, hexify([r / 255, g / 255, b / 255]), a);
}

/** 按 HLS 生成颜色：h 取 0–360 度。 */
function fromHls(hueDegrees, lightness, saturation) {
  return hexify(hlsToRgb(pyMod(hueDegrees / 360, 1), lightness, saturation));
}

module.exports = {
  pyRound, rgb, hexify, luminance, contrast, mix, alpha, rgbToHls, hlsToRgb, readable, rgbaToHex, fromHls,
};
