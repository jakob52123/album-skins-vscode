'use strict';

const zlib = require('node:zlib');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
// Node 20 没有 zlib.crc32；解码器自行校验 CRC，保持运行时兼容。
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** 解码非交错的 8 位灰度、RGB、RGBA PNG；alpha 不参与 RGB 输出。 */
function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('无效的 PNG 文件签名');
  }
  let width, height, channels;
  let offset = 8, ended = false, idatEnded = false;
  const idats = [];
  while (offset < buf.length) {
    if (buf.length - offset < 12) throw new Error('PNG 数据块不完整');
    const length = buf.readUInt32BE(offset);
    const end = offset + 8 + length;
    if (end + 4 > buf.length) throw new Error('PNG 数据块长度超出文件范围');
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('PNG 数据块类型无效');
    if (crc32(buf.subarray(offset + 4, end)) !== buf.readUInt32BE(end)) {
      throw new Error('PNG 数据块校验失败');
    }
    const data = buf.subarray(offset + 8, end);
    if (width === undefined && type !== 'IHDR') throw new Error('PNG 缺少起始图像头');
    if (type === 'IHDR') {
      if (width !== undefined || length !== 13) throw new Error('PNG 图像头无效或重复');
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (!width || !height) throw new Error('PNG 宽高必须大于零');
      if (data[8] !== 8) throw new Error('仅支持 8 位 PNG');
      channels = { 0: 1, 2: 3, 6: 4 }[data[9]];
      if (!channels) throw new Error('不支持此 PNG 颜色类型');
      if (data[10] !== 0 || data[11] !== 0) throw new Error('不支持此 PNG 压缩或滤波方法');
      if (data[12] !== 0) throw new Error('不支持交错 PNG');
    } else if (type === 'IDAT') {
      if (idatEnded) throw new Error('PNG 图像数据块必须连续');
      idats.push(data);
    } else if (type === 'IEND') {
      if (length || !idats.length) throw new Error('PNG 结束块无效或缺少图像数据');
      ended = true;
      offset = end + 4;
      break;
    } else {
      if (idats.length) idatEnded = true;
      if (type !== 'PLTE' && type[0] === type[0].toUpperCase()) {
        throw new Error('不支持的 PNG 关键数据块：' + type);
      }
      if (type === 'PLTE' && (channels === 1 || idats.length || !length || length > 768 || length % 3)) {
        throw new Error('PNG 调色板数据块无效');
      }
    }
    offset = end + 4;
  }
  if (!ended || offset !== buf.length) throw new Error('PNG 缺少结束块或存在多余数据');

  const stride = width * channels;
  const rawSize = (stride + 1) * height;
  const pixelSize = width * height * 3;
  if (!Number.isSafeInteger(rawSize) || rawSize > 0x7fffffff || pixelSize > 0x7fffffff) {
    throw new Error('PNG 图像尺寸过大');
  }
  let raw;
  try {
    // IDAT 边界不等于 zlib 流边界，必须先拼接再解压。
    raw = zlib.inflateSync(Buffer.concat(idats), { maxOutputLength: rawSize });
  } catch {
    throw new Error('PNG 图像数据解压失败或长度超限');
  }
  if (raw.length !== rawSize) throw new Error('PNG 扫描线数据长度不正确');

  const pixels = new Uint8Array(pixelSize);
  let previous = new Uint8Array(stride), row = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    if (filter > 4) throw new Error('不支持的 PNG 扫描线滤波类型');
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      row[x] = (raw[start + 1 + x] + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const src = x * channels, dest = (y * width + x) * 3;
      pixels[dest] = row[src];
      pixels[dest + 1] = row[src + (channels === 1 ? 0 : 1)];
      pixels[dest + 2] = row[src + (channels === 1 ? 0 : 2)];
    }
    [previous, row] = [row, previous];
  }
  return { width, height, pixels };
}

function rgbToHsl(rgb) {
  const [r, g, b] = rgb.map(c => c / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const chroma = max - min, l = (max + min) / 2;
  if (!chroma) return { h: 0, s: 0, l, chroma };
  let h;
  if (max === r) h = ((g - b) / chroma) % 6;
  else if (max === g) h = (b - r) / chroma + 2;
  else h = (r - g) / chroma + 4;
  return { h: (h * 60 + 360) % 360, s: chroma / (1 - Math.abs(2 * l - 1)), l, chroma };
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + rgb.map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const distance = (a, b) => a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0);
const hueDistance = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** 在精确 RGB 直方图上做加权 k-means；稳定排序、初始化和并列决策。 */
function clusterPixels(pixels) {
  const histogram = new Map();
  for (let i = 0; i < pixels.length; i += 3) {
    const key = pixels[i] * 65536 + pixels[i + 1] * 256 + pixels[i + 2];
    histogram.set(key, (histogram.get(key) || 0) + 1);
  }
  const points = [...histogram].sort((a, b) => a[0] - b[0]).map(([key, count]) => ({
    rgb: [key >>> 16, (key >>> 8) & 255, key & 255], count,
  }));
  const k = Math.min(5, points.length);
  const dominant = points.reduce((best, p) => p.count > best.count ? p : best);
  const centers = [dominant.rgb.slice()];
  // 从众数开始，按距离与像素权重选最远点，避免分位数重复或遗漏等亮异色。
  while (centers.length < k) {
    let best, bestScore = -1;
    for (const point of points) {
      const score = Math.min(...centers.map(c => distance(c, point.rgb))) * Math.sqrt(point.count);
      if (score > bestScore) { best = point; bestScore = score; }
    }
    centers.push(best.rgb.slice());
  }
  const nearest = rgb => {
    let index = 0, best = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const d = distance(rgb, centers[i]);
      if (d < best) { best = d; index = i; }
    }
    return index;
  };
  for (let iteration = 0; iteration < 40; iteration++) {
    const sums = centers.map(() => ({ rgb: [0, 0, 0], count: 0 }));
    for (const point of points) {
      const sum = sums[nearest(point.rgb)];
      sum.count += point.count;
      for (let c = 0; c < 3; c++) sum.rgb[c] += point.rgb[c] * point.count;
    }
    let movement = 0;
    for (let i = 0; i < k; i++) {
      if (!sums[i].count) continue; // 空簇保持原中心，不进行不确定的重采样。
      const next = sums[i].rgb.map(v => v / sums[i].count);
      movement += distance(centers[i], next);
      centers[i] = next;
    }
    if (movement < 1e-6) break;
  }
  const counts = centers.map(() => 0);
  for (const point of points) counts[nearest(point.rgb)] += point.count;
  const total = pixels.length / 3;
  return centers.map((rgb, i) => {
    const hsl = rgbToHsl(rgb);
    return { ...hsl, count: counts[i], score: counts[i] / total * hsl.s };
  }).filter(c => c.count).sort((a, b) => b.score - a.score || a.h - b.h);
}

// 在最终量化后的十六进制颜色上校验；只沿 HSL 明度方向调整，不改变色相。
function fitContrast(h, s, l, direction, requirements) {
  for (let step = 0; step <= 1000; step++) {
    const lightness = Math.max(0, Math.min(1, l + direction * step / 1000));
    const hex = hslToHex(h, s, lightness);
    if (requirements.every(([bg, minimum]) => contrast(hex, bg) >= minimum)) {
      return { hex, l: lightness };
    }
    if (lightness === 0 || lightness === 1) break;
  }
  throw new Error('无法在保留色相的同时满足配色对比度');
}

function makeTheme(source, secondary, dark) {
  const { h } = source;
  const s = Math.max(0.34, Math.min(0.65, source.s));
  const accentSaturation = source.neutral ? 0.12 : s;
  const surfaceSaturation = source.neutral ? 0.08 : 0.24;
  const surface = l => hslToHex(h, surfaceSaturation, l);
  const bg = surface(dark ? 0.09 : 0.95);
  const panel = surface(dark ? 0.13 : 0.91);
  const user = surface(dark ? 0.155 : 0.89);
  const tool = surface(dark ? 0.115 : 0.93);
  const direction = dark ? 1 : -1;
  const onAccent = dark ? bg : '#ffffff';
  const accent = fitContrast(h, accentSaturation, dark ? 0.70 : 0.42, direction,
    [[bg, 3], [onAccent, 4.5]]);
  const text = fitContrast(h, surfaceSaturation, dark ? 0.93 : 0.13, direction,
    [bg, panel, user, tool].map(color => [color, 7])).hex;
  const muted = fitContrast(h, surfaceSaturation, dark ? 0.72 : 0.38, direction, [[bg, 4.5]]).hex;
  const dim = fitContrast(h, surfaceSaturation, dark ? 0.56 : 0.48, direction, [[bg, 3]]).hex;
  const secondaryColor = (cluster, fallback) => cluster
    ? hslToHex(cluster.h, Math.max(0.45, Math.min(0.75, cluster.s)), dark ? 0.60 : 0.43)
    : fallback;
  const rgb = [1, 3, 5].map(i => parseInt(accent.hex.slice(i, i + 2), 16));
  return {
    bg,
    'bg-panel': panel,
    'bg-hover': surface(dark ? 0.18 : 0.86),
    'bg-selected': surface(dark ? 0.225 : 0.81),
    border: surface(dark ? 0.28 : 0.75),
    text,
    'text-muted': muted,
    'text-dim': dim,
    accent: accent.hex,
    'accent-hover': hslToHex(h, accentSaturation, accent.l + (dark ? 0.035 : -0.035)),
    'user-bg': user,
    'assistant-bg': bg,
    'tool-bg': tool,
    'bg-subtle': `rgba(${rgb.join(',')},.06)`,
    gold: secondaryColor(secondary[0], dark ? '#d59432' : '#b08a2a'),
    terracotta: secondaryColor(secondary[1], dark ? '#d1774b' : '#c9703f'),
    'on-accent': onAccent,
  };
}

/** 从非空、逐像素 RGB 字节生成浅色 / 深色的 17 项主题。无 I/O，无输入修改。 */
function generate(pixels) {
  if (!(pixels instanceof Uint8Array) || !pixels.length || pixels.length % 3) {
    throw new Error('像素必须是非空且长度为三的倍数的 RGB 字节数组');
  }
  const clusters = clusterPixels(pixels);
  const colorful = clusters.filter(c => c.chroma >= 0.06 && c.s >= 0.12);
  const colorfulCount = colorful.reduce((sum, c) => sum + c.count, 0);
  const neutral = colorfulCount / (pixels.length / 3) < 0.015;
  // 专辑封面多是人脸特写，按「占比 × 饱和度」会把肤色选成主色；肤色簇降权（不排除：
  // 本身就是金棕基调、没有别的彩色可选的封面，照样取到棕色）。
  const skin = c => c.h >= 8 && c.h <= 45 && c.s >= 0.15 && c.s <= 0.8 && c.l >= 0.2 && c.l <= 0.85;
  const ranked = colorful.map(c => ({ ...c, rank: c.score * (skin(c) ? 0.35 : 1) }))
    .sort((a, b) => b.rank - a.rank || a.h - b.h);
  const source = neutral ? { h: 155, s: 0.12, neutral: true } : ranked[0];
  // 两种辅助色均与主色相差至少 50°，相互也需拉开；不足则逐项回退。
  const candidates = neutral ? [] : colorful.filter(c => c.s >= 0.35
    && c.chroma >= 0.12 && hueDistance(c.h, source.h) >= 50);
  const gold = [...candidates].sort((a, b) => hueDistance(a.h, 45) - hueDistance(b.h, 45)
    || b.score - a.score)[0];
  const terracotta = candidates.find(c => c !== gold && hueDistance(c.h, gold.h) >= 50);
  const secondary = [gold, terracotta];
  return { light: makeTheme(source, secondary, false), dark: makeTheme(source, secondary, true) };
}

module.exports = { decodePng, generate };
