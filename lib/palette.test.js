'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const { decodePng, generate } = require('./palette.js');

const KEYS = ['bg', 'bg-panel', 'bg-hover', 'bg-selected', 'border', 'text', 'text-muted',
  'text-dim', 'accent', 'accent-hover', 'user-bg', 'assistant-bg', 'tool-bg', 'bg-subtle',
  'gold', 'terracotta', 'on-accent'];
const PAIRS = [['text', 'bg', 7], ['text', 'bg-panel', 7], ['text', 'user-bg', 7],
  ['text', 'tool-bg', 7], ['text-muted', 'bg', 4.5], ['text-dim', 'bg', 3],
  ['accent', 'bg', 3], ['on-accent', 'accent', 4.5]];
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  payload.copy(result, 4);
  // 当前环境使用 zlib.crc32；此后备实现让测试也能运行于 Node 20。
  let checksum;
  if (typeof zlib.crc32 === 'function') {
    checksum = zlib.crc32(payload);
  } else {
    checksum = 0xffffffff;
    for (const value of payload) {
      checksum ^= value;
      for (let bit = 0; bit < 8; bit++) {
        checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0);
      }
    }
    checksum = (checksum ^ 0xffffffff) >>> 0;
  }
  result.writeUInt32BE(checksum, result.length - 4);
  return result;
}

// 独立的正向滤波编码器：从原始本行、上行取邻点，而不是解码后的输出。
function encodeRows(samples, width, height, channels, filters) {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = filters[y % filters.length];
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const left = x >= channels ? samples[i - channels] : 0;
      const up = y ? samples[i - stride] : 0;
      const diagonal = y && x >= channels ? samples[i - stride - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      if (filter === 2) predictor = up;
      if (filter === 3) predictor = Math.floor((left + up) / 2);
      if (filter === 4) {
        const estimate = left + up - diagonal;
        const neighbors = [left, up, diagonal];
        const errors = neighbors.map(v => Math.abs(v - estimate));
        predictor = neighbors[errors.indexOf(Math.min(...errors))];
      }
      raw[y * (stride + 1) + 1 + x] = (samples[i] - predictor + 256) % 256;
    }
  }
  return raw;
}

function makePng(options = {}) {
  const { width = 6, height = 5, colorType = 2, bitDepth = 8, interlace = 0,
    compression = 0, filterMethod = 0, filters = [0, 1, 2, 3, 4] } = options;
  const channels = { 0: 1, 2: 3, 6: 4 }[colorType] || 3;
  const samples = options.samples || Buffer.from(Array.from({ length: width * height * channels },
    (_, i) => (i * 73 + Math.floor(i / (width * channels)) * 41 + (i * i) % 251) & 255));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = bitDepth;
  header[9] = colorType;
  header[10] = compression;
  header[11] = filterMethod;
  header[12] = interlace;
  const raw = options.raw || encodeRows(samples, width, height, channels, filters);
  const compressed = options.compressed || zlib.deflateSync(raw);
  // 刻意切开 zlib 头部和压缩流，确保不能逐块单独 inflate。
  const cut = Math.floor(compressed.length / 2);
  const png = Buffer.concat([SIGNATURE, chunk('IHDR', header),
    chunk('IDAT', compressed.subarray(0, 1)), chunk('IDAT', compressed.subarray(1, cut)),
    chunk('IDAT', compressed.subarray(cut)), chunk('IEND', Buffer.alloc(0))]);
  const rgb = [];
  for (let i = 0; i < width * height; i++) {
    const start = i * channels;
    rgb.push(samples[start], samples[start + (channels === 1 ? 0 : 1)],
      samples[start + (channels === 1 ? 0 : 2)]);
  }
  return { png, pixels: Uint8Array.from(rgb), width, height };
}

const chineseError = error => error instanceof Error && /[\u4e00-\u9fff]/u.test(error.message);

for (const [name, colorType] of [['灰度', 0], ['RGB', 2], ['RGBA', 6]]) {
  for (const filters of [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4]]) {
    test(`decodePng ${name} 滤波 ${filters.join('/')}，多个 IDAT`, () => {
      const expected = makePng({ colorType, filters });
      const original = Buffer.from(expected.png);
      const actual = decodePng(expected.png);
      assert.equal(actual.width, expected.width);
      assert.equal(actual.height, expected.height);
      assert.ok(actual.pixels instanceof Uint8Array);
      assert.deepEqual(actual.pixels, expected.pixels);
      assert.deepEqual(expected.png, original, '不得修改 PNG 输入');
    });
  }
}

test('decodePng RGBA 丢弃透明度，不与背景混色；单像素边界', () => {
  for (const alpha of [0, 128, 255]) {
    const image = makePng({ width: 1, height: 1, colorType: 6, filters: [4],
      samples: Buffer.from([12, 190, 234, alpha]) });
    assert.deepEqual(decodePng(image.png).pixels, Uint8Array.from([12, 190, 234]));
  }
});

for (const [name, options] of [
  ['16 位', { bitDepth: 16 }], ['交错', { interlace: 1 }],
  ['索引色', { colorType: 3 }], ['灰度带透明', { colorType: 4 }],
  ['未知压缩方法', { compression: 1 }], ['未知滤波方法', { filterMethod: 1 }],
  ['零宽度', { width: 0 }], ['零高度', { height: 0 }],
  ['未知扫描线滤波', { filters: [5] }],
  ['损坏压缩流', { compressed: Buffer.from([1, 2, 3]) }],
  ['扫描线长度不足', { raw: Buffer.from([0, 1, 2]) }],
  ['解压长度超限', { raw: Buffer.alloc(1000) }],
]) {
  test(`decodePng 拒绝${name}，错误消息为中文`, () => {
    assert.throws(() => decodePng(makePng(options).png), chineseError);
  });
}

test('decodePng 拒绝签名、数据块、CRC、结束块错误及未知关键块', () => {
  const { png } = makePng();
  const corrupt = Buffer.from(png);
  corrupt[29] ^= 1;
  const unknownChunk = Buffer.concat([png.subarray(0, 33), chunk('ABCD', Buffer.alloc(0)), png.subarray(33)]);
  const duplicateHeader = Buffer.concat([png.subarray(0, 33), png.subarray(8, 33), png.subarray(33)]);
  const nonconsecutive = Buffer.concat([png.subarray(0, 46), chunk('tEXt', Buffer.from('a\0b')), png.subarray(46)]);
  for (const input of [null, new Uint8Array(png), Buffer.alloc(0), Buffer.alloc(8),
    png.subarray(0, 10), png.subarray(0, 34), png.subarray(0, -12),
    Buffer.concat([png, Buffer.from([0])]), corrupt, unknownChunk, duplicateHeader, nonconsecutive]) {
    assert.throws(() => decodePng(input), chineseError);
  }
  // 未知辅助块可以安全忽略。
  const ancillary = Buffer.concat([png.subarray(0, 33), chunk('tEXt', Buffer.from('a\0b')), png.subarray(33)]);
  assert.deepEqual(decodePng(ancillary).pixels, decodePng(png).pixels);
});

// 独立 WCAG 实现，严格使用契约阈值，不加容差。
function luminance(hex) {
  const components = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722;
}

function contrast(a, b) {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high + 0.05) / (low + 0.05);
}

function checkPalette(pixels) {
  const original = new Uint8Array(pixels);
  const palette = generate(pixels);
  assert.deepEqual(Object.keys(palette).sort(), ['dark', 'light']);
  assert.deepEqual(generate(pixels), palette, '相同输入必须完全确定');
  assert.deepEqual(pixels, original, '不得修改像素输入');
  for (const mode of ['light', 'dark']) {
    const p = palette[mode], dark = mode === 'dark';
    assert.deepEqual(Object.keys(p).sort(), [...KEYS].sort(), `${mode} 必须恰好 17 个键`);
    for (const key of KEYS) {
      assert.match(p[key], key === 'bg-subtle'
        ? /^rgba\(\d{1,3},\d{1,3},\d{1,3},\.06\)$/ : /^#[0-9a-f]{6}$/, `${mode}.${key}`);
    }
    const accentRgb = p.accent.slice(1).match(/../g).map(v => parseInt(v, 16));
    assert.equal(p['bg-subtle'], `rgba(${accentRgb.join(',')},.06)`);
    assert.equal(p['assistant-bg'], p.bg);
    assert.equal(p['on-accent'], dark ? p.bg : '#ffffff');
    for (const [a, b, threshold] of PAIRS) {
      assert.ok(contrast(p[a], p[b]) >= threshold,
        `${mode} ${a}/${b}=${contrast(p[a], p[b])} < ${threshold}`);
    }
    assert.ok(dark ? luminance(p.bg) <= 0.05 : luminance(p.bg) >= 0.7);
    const layers = ['bg', 'tool-bg', 'bg-panel', 'user-bg', 'bg-hover', 'bg-selected', 'border'];
    for (let i = 1; i < layers.length; i++) {
      const previous = luminance(p[layers[i - 1]]), current = luminance(p[layers[i]]);
      assert.ok(dark ? current > previous : current < previous, `${mode} 层级 ${layers[i]}`);
    }
    const textL = luminance(p.text), mutedL = luminance(p['text-muted']), dimL = luminance(p['text-dim']);
    assert.ok(dark ? textL > mutedL && mutedL > dimL : textL < mutedL && mutedL < dimL);
    assert.ok(dark ? luminance(p['accent-hover']) > luminance(p.accent)
      : luminance(p['accent-hover']) < luminance(p.accent));
  }
  return palette;
}

const solid = (rgb, count = 1024) => Uint8Array.from(Array.from({ length: count * 3 }, (_, i) => rgb[i % 3]));
const combine = (...pixels) => Uint8Array.from(pixels.flatMap(p => [...p]));

for (const [name, rgb] of [
  ['纯灰', [128, 128, 128]], ['纯黑', [0, 0, 0]], ['纯白', [255, 255, 255]],
  ['单一红色', [255, 0, 0]], ['单一绿色', [0, 255, 0]], ['单一蓝色', [0, 0, 255]],
  ['单一青色', [0, 255, 255]], ['单一品红', [255, 0, 255]], ['单一黄色', [255, 255, 0]],
  ['近黑微红', [2, 1, 1]], ['近白微蓝', [254, 254, 255]],
]) {
  test(`generate ${name}`, () => { checkPalette(solid(rgb)); });
}

test('generate 无彩色输入使用同一个低饱和中性主色及固定辅助色', () => {
  const grayRamp = Uint8Array.from(Array.from({ length: 256 * 3 }, (_, i) => Math.floor(i / 3)));
  const expected = checkPalette(solid([128, 128, 128]));
  for (const input of [solid([0, 0, 0]), solid([255, 255, 255]), grayRamp]) {
    assert.deepEqual(checkPalette(input), expected);
  }
  for (const mode of ['light', 'dark']) {
    const p = expected[mode];
    const components = p.accent.slice(1).match(/../g).map(v => parseInt(v, 16) / 255);
    const min = Math.min(...components), max = Math.max(...components);
    const saturation = (max - min) / (1 - Math.abs(max + min - 1));
    assert.ok(saturation < 0.2, '中性回退不应高饱和');
    assert.equal(p.gold, mode === 'light' ? '#b08a2a' : '#d59432');
    assert.equal(p.terracotta, mode === 'light' ? '#c9703f' : '#d1774b');
  }
});

test('generate 双色对半、三色与占比乘饱和度主色选择', () => {
  checkPalette(combine(solid([255, 0, 0], 512), solid([0, 0, 255], 512)));
  const tri = checkPalette(combine(solid([0, 0, 255], 600), solid([255, 255, 0], 250), solid([255, 0, 0], 174)));
  assert.notEqual(tri.light.gold, '#b08a2a', '存在远色相簇时不应回退 gold');
  assert.notEqual(tri.light.terracotta, '#c9703f', '第二个远色相簇应提供 terracotta');
  // 低饱和红占比 60%，高饱和蓝占比 40%，乘积应使蓝色胜出。
  const weighted = checkPalette(combine(solid([150, 110, 110], 600), solid([0, 0, 255], 400)));
  const [r, , b] = weighted.light.accent.slice(1).match(/../g).map(v => parseInt(v, 16));
  assert.ok(b > r, '主色应来自饱和度加权后胜出的蓝色簇');
});

test('generate 对像素顺序不敏感，不依赖外部状态', () => {
  const image = combine(solid([20, 140, 70], 300), solid([200, 80, 40], 200), solid([150, 150, 150], 500));
  const reversed = new Uint8Array(image.length);
  for (let i = 0; i < image.length; i += 3) reversed.set(image.subarray(i, i + 3), image.length - i - 3);
  const first = generate(image);
  generate(solid([30, 30, 200]));
  assert.deepEqual(generate(image), first);
  assert.deepEqual(generate(reversed), first);
});

test('generate 单像素、近乎无彩色及全色相压力检查', () => {
  checkPalette(Uint8Array.from([12, 140, 90]));
  checkPalette(combine(solid([127, 127, 127], 1023), solid([255, 0, 0], 1)));
  // 确定性 RGB 网格覆盖低/高亮、饱和与非饱和输入，不使用随机数。
  for (const r of [0, 51, 102, 153, 204, 255]) {
    for (const g of [0, 51, 102, 153, 204, 255]) {
      for (const b of [0, 51, 102, 153, 204, 255]) checkPalette(solid([r, g, b], 1));
    }
  }
});

test('generate 拒绝非 RGB 字节数组和空输入', () => {
  for (const input of [null, [], [1, 2, 3], new Uint8Array(0), new Uint8Array(2), new Uint16Array(3)]) {
    assert.throws(() => generate(input), chineseError);
  }
  assert.deepEqual(generate(Buffer.from([12, 34, 56])), generate(Uint8Array.from([12, 34, 56])));
});

// 真实封面小图有版权，不进仓库：放在 fixtures/（已 gitignore）或用 ALBUM_SKINS_FIXTURES 指定目录时才跑。
const fixtureDir = process.env.ALBUM_SKINS_FIXTURES || path.join(__dirname, '..', 'fixtures');
const fixtureFiles = fs.existsSync(fixtureDir)
  ? fs.readdirSync(fixtureDir).filter(file => file.endsWith('.png')).sort() : [];
test('真实封面 fixtures', { skip: fixtureFiles.length ? false : '没有 fixtures 目录，跳过真实封面测试' }, () => {
  assert.ok(fixtureFiles.length > 0);
});
for (const file of fixtureFiles) {
  test(`generate fixture ${file}`, () => {
    const png = fs.readFileSync(path.join(fixtureDir, file));
    const image = decodePng(png);
    assert.equal(image.width, png.readUInt32BE(16));
    assert.equal(image.height, png.readUInt32BE(20));
    assert.ok(image.width >= 24 && image.width <= 32);
    assert.ok(image.height >= 24 && image.height <= 32);
    assert.equal(image.pixels.length, image.width * image.height * 3);
    checkPalette(image.pixels);
  });
}
