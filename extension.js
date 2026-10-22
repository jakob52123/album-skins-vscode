// 周杰伦专辑皮肤：每日洗牌（洗牌袋，一轮内不重复）+ 手动选择 + 可选的渐隐封面背景。
'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const albums = require('./albums.json');

const STATE_KEY = 'daily-v1';
const OVERRIDE_KEY = 'override';
const SEEN_KEY = 'initialized';
const PREVIOUS_BACKGROUND_KEY = 'previous-background';
// 仿 pi-web：封面靠右、往左渐隐。
const FADE = 'linear-gradient(to left, #000 0%, rgba(0,0,0,.75) 25%, transparent 62%)';
const OPACITY = { light: 0.12, dark: 0.16 };
const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const slugs = albums.map((album) => album.slug);
const bySlug = new Map(albums.map((album) => [album.slug, album]));
const ourThemes = new Set(albums.flatMap((album) => [album.light, album.dark]));

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shuffle(values) {
  const bag = values.slice();
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

function valid(state) {
  return state && state.version === 1 && /^\d{4}-\d{2}-\d{2}$/.test(state.date) && bySlug.has(state.slug) &&
    Array.isArray(state.bag) && state.bag.every((slug, i) => bySlug.has(slug) && state.bag.indexOf(slug) === i);
}

/** 今天的专辑；force 为真时从袋里再抽一张（「换一张」）。 */
async function daily(context, force) {
  const day = today();
  let state = context.globalState.get(STATE_KEY);
  if (!valid(state)) state = null;
  if (state && state.date === day && !force) return state.slug;
  if (!state) {
    const first = 'yehuimei';
    state = { version: 1, date: day, slug: first, bag: shuffle(slugs.filter((slug) => slug !== first)) };
  } else {
    const bag = state.bag.length ? state.bag.slice() : shuffle(slugs);
    if (bag[0] === state.slug && bag.length > 1) [bag[0], bag[1]] = [bag[1], bag[0]];
    state = { version: 1, date: day, slug: bag.shift(), bag };
  }
  await context.globalState.update(STATE_KEY, state);
  return state.slug;
}

function isDark() {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function setIfChanged(section, key, value) {
  const config = vscode.workspace.getConfiguration(section);
  if (JSON.stringify(config.get(key)) !== JSON.stringify(value)) {
    await config.update(key, value, vscode.ConfigurationTarget.Global);
  }
}

async function apply(context, slug) {
  const album = bySlug.get(slug);
  const current = vscode.workspace.getConfiguration('workbench').get('colorTheme');
  const dark = current === album.light ? false : current === album.dark ? true : ourThemes.has(current)
    ? albums.some((a) => a.dark === current) : isDark();
  // 系统自动深浅（window.autoDetectColorScheme）开着时走 preferred*，两边都写上。
  await setIfChanged('workbench', 'preferredDarkColorTheme', album.dark);
  await setIfChanged('workbench', 'preferredLightColorTheme', album.light);
  await setIfChanged('workbench', 'colorTheme', dark ? album.dark : album.light);
}

/** VS Code 给 .monaco-workbench 加的主题 class，规则同 workbench 源码里的 fromExtensionTheme。 */
function themeClass(extensionId, themePath) {
  let name = `${extensionId}-${themePath.replace(/^\.\//, '')}`.replace(/[^_a-zA-Z0-9-]/g, '-');
  if (/^[0-9-]/.test(name)) name = `_${name}`;
  return name;
}

/**
 * 换封面不重载窗口：借 background 插件的自定义样式，塞进「主题 class → 封面」的 CSS 规则。
 * 换专辑本来就会换主题，主题一换封面跟着换。background 配置只在规则变化时写一次。
 */
function coverConfig(context) {
  const dir = coverDir(context);
  const classes = new Map(context.extension.packageJSON.contributes.themes.map(
    (theme) => [theme.label, themeClass(context.extension.id, theme.path)]));
  const rules = albums.flatMap((album) => {
    const url = require('url').pathToFileURL(path.join(dir, `${album.slug}.jpg`)).href
      .replace('file://', 'vscode-file://vscode-app');
    return ['light', 'dark'].map((mode) => `body:has(> .monaco-workbench.${classes.get(album[mode])})::after{` +
      `background-image:url(${url}) !important;opacity:${OPACITY[mode]} !important}`);
  });
  // 值里先闭合 body::after，再接各条规则，最后重开一个 body::after 接住插件追加的兜底图（透明 1px）。
  const inject = `0}${rules.join('')}body::after{--jay-album-end:0`;
  return {
    images: [TRANSPARENT], opacity: OPACITY.dark, size: 'auto 100%', position: 'right center',
    styles: [{ '-webkit-mask-image': FADE, 'mask-image': FADE, '--jay-album': inject }], interval: 0, random: false,
  };
}

/** 封面不随扩展分发，放在扩展自己的全局存储里（路径不随版本变，升级不用重写 background 配置）。 */
function coverDir(context) {
  return path.join(context.globalStorageUri.fsPath, 'covers');
}

function coverMissing(context) {
  return albums.filter((album) => !['', '-thumb'].every((suffix) =>
    fs.existsSync(path.join(coverDir(context), `${album.slug}${suffix}.jpg`))));
}

async function download(url, target) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const temp = `${target}.part`;
  fs.writeFileSync(temp, Buffer.from(await response.arrayBuffer()));
  fs.renameSync(temp, target);
}

/** 从 Apple iTunes 公开接口把封面下载到本机；已下载的跳过。 */
async function downloadCovers(context) {
  const missing = coverMissing(context);
  if (!missing.length) return true;
  fs.mkdirSync(coverDir(context), { recursive: true });
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '正在从 iTunes 下载专辑封面' },
      async (progress) => {
        const ids = missing.map((album) => album.itunesId).join(',');
        const response = await fetch(`https://itunes.apple.com/lookup?id=${ids}&country=tw`);
        if (!response.ok) throw new Error(`iTunes lookup ${response.status}`);
        const artwork = new Map((await response.json()).results.map((r) => [r.collectionId, r.artworkUrl100]));
        for (const album of missing) {
          progress.report({ message: album.title, increment: 100 / missing.length });
          const small = artwork.get(album.itunesId);
          if (!small) throw new Error(`iTunes 上找不到《${album.title}》`);
          await download(small.replace(/\/\d+x\d+bb\./, '/1200x1200bb.'), path.join(coverDir(context), `${album.slug}.jpg`));
          await download(small.replace(/\/\d+x\d+bb\./, '/96x96bb.'), path.join(coverDir(context), `${album.slug}-thumb.jpg`));
        }
      });
    return true;
  } catch (error) {
    vscode.window.showErrorMessage(`专辑封面下载失败：${error.message}。检查网络后重新打开「jayAlbum.syncBackground」。`);
    return false;
  }
}

async function applyCover(context) {
  if (!(await downloadCovers(context))) return;
  const background = vscode.workspace.getConfiguration('background');
  const fullscreen = background.inspect('fullscreen')?.globalValue || {};
  const desired = coverConfig(context);
  if (stable(fullscreen) === stable(desired)) return;
  // 第一次接管：记下原来的背景，关掉封面时还原。之后由 background 插件自己提示重载（只这一次）。
  if (!context.globalState.get(PREVIOUS_BACKGROUND_KEY)) {
    await context.globalState.update(PREVIOUS_BACKGROUND_KEY, fullscreen);
  }
  await background.update('fullscreen', desired, vscode.ConfigurationTarget.Global);
}

async function restoreBackground(context) {
  const previous = context.globalState.get(PREVIOUS_BACKGROUND_KEY);
  if (!previous) return;
  await vscode.workspace.getConfiguration('background').update('fullscreen', previous, vscode.ConfigurationTarget.Global);
  await context.globalState.update(PREVIOUS_BACKGROUND_KEY, undefined);
}

async function effective(context) {
  const override = context.globalState.get(OVERRIDE_KEY, '');
  return bySlug.has(override) ? override : daily(context, false);
}

function activate(context) {
  // 两段：专辑名用金色，年份压暗，读起来有主次。
  const title = vscode.window.createStatusBarItem('jayAlbum.title', vscode.StatusBarAlignment.Right, 1001);
  const year = vscode.window.createStatusBarItem('jayAlbum.year', vscode.StatusBarAlignment.Right, 1000);
  for (const item of [title, year]) {
    item.name = '周杰伦专辑';
    item.command = 'jayAlbum.pick';
    context.subscriptions.push(item);
  }
  title.color = new vscode.ThemeColor('jayAlbum.title');
  year.color = new vscode.ThemeColor('jayAlbum.year');

  function render() {
    const current = vscode.workspace.getConfiguration('workbench').get('colorTheme');
    const album = albums.find((a) => a.light === current || a.dark === current);
    if (!album) {
      title.hide();
      year.hide();
      return;
    }
    title.text = `$(music) ${album.title}`;
    year.text = String(album.year);
    title.accessibilityInformation = { label: `周杰伦专辑：${album.title}，${album.year}` };
    title.show();
    year.show();
  }

  function thumb(album) {
    const file = path.join(coverDir(context), `${album.slug}-thumb.jpg`);
    return fs.existsSync(file) ? vscode.Uri.file(file) : new vscode.ThemeIcon('music');
  }

  async function refresh(force) {
    // 只有正在用本皮肤（或第一次装）时才自动换，用户换成别的主题就不再打扰。
    const current = vscode.workspace.getConfiguration('workbench').get('colorTheme');
    const first = !context.globalState.get(SEEN_KEY);
    if (!force && !first && !ourThemes.has(current)) return render();
    if (!force && !first && !vscode.workspace.getConfiguration('jayAlbum').get('dailyShuffle') &&
        !context.globalState.get(OVERRIDE_KEY)) return render();
    await context.globalState.update(SEEN_KEY, true);
    await apply(context, await effective(context));
    render();
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('jayAlbum.pick', async () => {
      const override = context.globalState.get(OVERRIDE_KEY, '');
      const todays = await daily(context, false);
      const picks = [
        {
          label: '每日随机', description: `${override ? '' : '✓ '}今天是《${bySlug.get(todays).title}》`,
          iconPath: new vscode.ThemeIcon('calendar'), slug: '',
        },
        { label: '专辑', kind: vscode.QuickPickItemKind.Separator },
        ...albums.map((a) => ({
          label: a.title, description: `${a.year}${override === a.slug ? '  ✓ 当前' : ''}`, detail: a.mood,
          iconPath: thumb(a), slug: a.slug,
        })),
      ];
      const choice = await vscode.window.showQuickPick(picks, { placeHolder: '选一张专辑', matchOnDetail: true });
      if (!choice) return;
      await context.globalState.update(OVERRIDE_KEY, choice.slug);
      await refresh(true);
    }),
    vscode.commands.registerCommand('jayAlbum.next', async () => {
      await context.globalState.update(OVERRIDE_KEY, '');
      await daily(context, true);
      await refresh(true);
    }),
    vscode.commands.registerCommand('jayAlbum.daily', async () => {
      await context.globalState.update(OVERRIDE_KEY, '');
      await refresh(true);
    }),
    vscode.window.onDidChangeActiveColorTheme(render),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration('jayAlbum.syncBackground')) return;
      if (vscode.workspace.getConfiguration('jayAlbum').get('syncBackground')) {
        await applyCover(context);
      } else {
        await restoreBackground(context);
      }
    }),
  );

  // 跨午夜也要换：每 10 分钟看一眼日期。
  let lastDay = today();
  const timer = setInterval(() => {
    if (today() !== lastDay) {
      lastDay = today();
      refresh(false);
    }
  }, 10 * 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  if (vscode.workspace.getConfiguration('jayAlbum').get('syncBackground')) applyCover(context);
  refresh(false);
}

function deactivate() {}

module.exports = { activate, deactivate };
