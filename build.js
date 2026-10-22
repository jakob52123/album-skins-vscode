#!/usr/bin/env node
// 从 data/albums.json 生成：内置专辑主题、自定义空位主题、albums.json、package.json、docs/palettes.svg。
'use strict';
const fs = require('fs');
const path = require('path');
const { rgbaToHex } = require('./lib/color');
const { NEUTRAL, buildTheme } = require('./lib/theme');

const ROOT = __dirname;
const VERSION = '2.2.0';
const REPOSITORY = 'https://github.com/jakob52123/album-skins-vscode';
const SLOTS = 10;

const mode = (m) => (m === 'dark' ? '深' : '浅');
const builtinLabel = (album, m) => `${album.artist} · ${album.title} ${album.year}（${mode(m)}）`;
const slotLabel = (n, m) => `专辑皮肤 · 自定义 ${String(n).padStart(2, '0')}（${mode(m)}）`;

function writeJson(file, value, indent = 1) {
  fs.writeFileSync(path.join(ROOT, file), `${JSON.stringify(value, null, indent)}\n`);
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** README 用的配色预览：每张专辑浅/深两条色带，只有色块和文字，不含封面。 */
function palettesSvg(albums) {
  const keys = ['bg', 'bg-panel', 'bg-selected', 'border', 'text-muted', 'text', 'accent', 'gold', 'terracotta'];
  const cell = 22; const rowH = 30; const labelW = 190; const gap = 14;
  const width = labelW + 2 * (keys.length * cell + gap) + 10;
  const rows = albums.flatMap((album, i) => {
    const y = 40 + i * rowH;
    return [`<text x="10" y="${y + 16}" class="t">${escapeXml(album.title)}<tspan class="y"> ${album.year}</tspan></text>`,
      ...['light', 'dark'].flatMap((m, j) => keys.map((key, k) => {
        const x = labelW + j * (keys.length * cell + gap) + k * cell;
        return `<rect x="${x}" y="${y}" width="${cell}" height="${rowH - 6}" fill="${rgbaToHex(album[m][key], album[m].bg)}"/>`;
      }))];
  });
  const height = 40 + albums.length * rowH + 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + '<style>.t{font:600 14px "PingFang SC","Noto Sans SC",sans-serif;fill:#8a7a5a}'
    + '.y{font:400 12px "PingFang SC","Noto Sans SC",sans-serif;fill:#8a8a8a}</style>'
    + `<text x="${labelW}" y="24" class="y">浅色</text>`
    + `<text x="${labelW + keys.length * cell + gap}" y="24" class="y">深色</text>${rows.join('')}</svg>\n`;
}

function main() {
  const albums = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'albums.json'), 'utf8')).albums;
  fs.rmSync(path.join(ROOT, 'themes'), { recursive: true, force: true });
  fs.mkdirSync(path.join(ROOT, 'themes'));
  const themes = [];
  const add = (file, label, m, palette) => {
    writeJson(`themes/${file}`, buildTheme(palette, m, label));
    themes.push({ label, uiTheme: m === 'dark' ? 'vs-dark' : 'vs', path: `./themes/${file}` });
  };
  for (const album of albums) {
    for (const m of ['light', 'dark']) add(`${album.slug}-${m}.json`, builtinLabel(album, m), m, album[m]);
  }
  for (let n = 1; n <= SLOTS; n++) {
    for (const m of ['light', 'dark']) add(`slot-${String(n).padStart(2, '0')}-${m}.json`, slotLabel(n, m), m, NEUTRAL[m]);
  }
  writeJson('albums.json', {
    builtin: albums.map((a) => ({
      slug: a.slug, title: a.title, artist: a.artist, year: a.year, mood: a.mood, itunesId: a.itunesId,
      light: builtinLabel(a, 'light'), dark: builtinLabel(a, 'dark'),
    })),
    slots: Array.from({ length: SLOTS }, (_, i) => ({ light: slotLabel(i + 1, 'light'), dark: slotLabel(i + 1, 'dark') })),
  });
  fs.writeFileSync(path.join(ROOT, 'docs', 'palettes.svg'), palettesSvg(albums));

  const command = (id, title) => ({ command: `albumSkins.${id}`, title, category: '专辑皮肤' });
  writeJson('package.json', {
    name: 'album-skins', displayName: '专辑皮肤 Album Skins', publisher: 'jakob',
    description: '把专辑封面变成 VS Code 主题：内置 16 张周杰伦专辑（深浅各一），也能搜任意专辑自动取色；每日随机，可选渐隐封面。',
    version: VERSION, license: 'MIT', repository: { type: 'git', url: REPOSITORY },
    bugs: { url: `${REPOSITORY}/issues` }, homepage: `${REPOSITORY}#readme`,
    keywords: ['theme', 'color-theme', 'album', 'music', 'jay chou', '周杰伦', 'chinese'],
    engines: { vscode: '^1.90.0' }, categories: ['Themes'], main: './extension.js',
    activationEvents: ['onStartupFinished'],
    contributes: {
      themes,
      colors: [
        { id: 'albumSkins.title', description: '状态栏专辑名', defaults: { dark: '#d59432', light: '#8a6a1c', highContrast: '#ffd27a' } },
      ],
      commands: [
        command('pick', '选专辑'), command('next', '换一张'), command('daily', '恢复每日随机'),
        command('add', '添加专辑…'), command('toggleDiscreet', '低调模式（开/关）'),
      ],
      configuration: {
        title: '专辑皮肤',
        properties: {
          'albumSkins.dailyShuffle': { type: 'boolean', default: true, order: 1, description: '每天自动换一张专辑。' },
          'albumSkins.shuffle': {
            type: 'string', default: 'all', enum: ['all', 'favorites', 'release-order'], order: 2,
            enumDescriptions: ['从全部专辑（不含排除的）里洗牌，一轮内不重复', '只从收藏的专辑里洗牌', '按发行年份依次轮换'],
            description: '每日换专辑的方式。',
          },
          'albumSkins.favorites': { type: 'array', items: { type: 'string' }, default: [], order: 3, description: '收藏的专辑（在「选专辑」列表里点 ☆ 管理）。' },
          'albumSkins.excluded': { type: 'array', items: { type: 'string' }, default: [], order: 4, description: '不参与每日随机的专辑（在「选专辑」列表里点 ⊘ 管理）。' },
          'albumSkins.followSystemAppearance': { type: 'boolean', default: false, order: 5, description: '同一张专辑跟随系统外观：白天浅色、晚上深色（打开 VS Code 的 window.autoDetectColorScheme）。' },
          'albumSkins.discreet': { type: 'boolean', default: false, order: 6, description: '低调模式：隐藏状态栏专辑名和封面，只保留配色。适合开会投屏。' },
          'albumSkins.syncBackground': { type: 'boolean', default: false, order: 7, description: '用 background 扩展（shalldie.background）在窗口右侧显示渐隐的专辑封面。封面在首次开启时从 Apple iTunes 下载到本机；换专辑时即时跟着换；关掉会还原原来的背景。' },
          'albumSkins.backgroundOpacity': {
            type: ['number', 'null'], default: null, minimum: 0.05, maximum: 0.6, order: 8,
            description: '渐隐封面的不透明度，越大越明显。null 按主题使用默认值（深色 0.30、浅色 0.22）。仅在 syncBackground 开启时生效。',
          },
          'albumSkins.backgroundOpacityDark': {
            type: ['number', 'null'], default: null, minimum: 0.05, maximum: 0.6, order: 9,
            description: '深色主题的封面不透明度；null 继承 backgroundOpacity，未设置时为 0.30。',
          },
          'albumSkins.backgroundOpacityLight': {
            type: ['number', 'null'], default: null, minimum: 0.05, maximum: 0.6, order: 10,
            description: '浅色主题的封面不透明度；null 继承 backgroundOpacity，未设置时为 0.22。',
          },
        },
      },
    },
  }, 2);
  console.log(`builtin=${albums.length} themes=${themes.length}`);
}

main();
