// 专辑皮肤：内置专辑 + 用户自加专辑；每日换（洗牌 / 只收藏 / 按年份）、选择时预览、低调模式、可选渐隐封面。
'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const manifest = require('./albums.json');
const { buildTheme } = require('./lib/theme');
const { decodePng, generate } = require('./lib/palette');
const itunes = require('./lib/itunes');
const { resolveBackgroundOpacity } = require('./lib/background');

const STATE_KEY = 'daily-v2';
const OVERRIDE_KEY = 'override';
const SEEN_KEY = 'initialized';
const PREVIOUS_BACKGROUND_KEY = 'previous-background';
const PREVIOUS_AUTODETECT_KEY = 'previous-auto-detect';
const MARKERS = ['--album-skins', '--jay-album'];
// 仿 pi-web：封面靠右、往左渐隐。
const FADE = 'linear-gradient(to left, #000 0%, rgba(0,0,0,.75) 25%, transparent 62%)';
const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const SLOT_LABELS = new Set(manifest.slots.flatMap((slot) => [slot.light, slot.dark]));

let ctx;

const config = () => vscode.workspace.getConfiguration('albumSkins');
const currentTheme = () => vscode.workspace.getConfiguration('workbench').get('colorTheme');
const coverDir = () => path.join(ctx.globalStorageUri.fsPath, 'covers');
const customFile = () => path.join(ctx.globalStorageUri.fsPath, 'custom-albums.json');
const slotKey = (slot) => String(slot + 1).padStart(2, '0');

// ── 专辑注册表 ───────────────────────────────────────────

function loadCustom() {
  try {
    const list = JSON.parse(fs.readFileSync(customFile(), 'utf8'));
    return Array.isArray(list) ? list.filter((a) => a && a.slug && manifest.slots[a.slot] && a.light && a.dark) : [];
  } catch {
    return [];
  }
}

function saveCustom(list) {
  fs.mkdirSync(path.dirname(customFile()), { recursive: true });
  fs.writeFileSync(customFile(), JSON.stringify(list, null, 1));
}

/** 内置专辑在前（按年份），自定义专辑在后（按加入顺序）。 */
function albums() {
  const custom = loadCustom().map((a) => ({
    ...a, custom: true, mood: a.artist, light: manifest.slots[a.slot].light, dark: manifest.slots[a.slot].dark,
    palettes: { light: a.light, dark: a.dark },
  }));
  return [...manifest.builtin, ...custom];
}

const findAlbum = (slug) => albums().find((a) => a.slug === slug);
const albumForTheme = (name) => albums().find((a) => a.light === name || a.dark === name);
const isOurTheme = (name) => SLOT_LABELS.has(name) || manifest.builtin.some((a) => a.light === name || a.dark === name);

// ── 每日换专辑 ───────────────────────────────────────────

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

/** 参与每日随机的专辑：去掉排除的；「只收藏」模式下只留收藏的（收藏为空时不生效）。 */
function pool() {
  const excluded = new Set(config().get('excluded'));
  let list = albums().filter((a) => !excluded.has(a.slug));
  if (config().get('shuffle') === 'favorites') {
    const favorites = new Set(config().get('favorites'));
    const picked = list.filter((a) => favorites.has(a.slug));
    if (picked.length) list = picked;
  }
  return list.length ? list : albums();
}

/** 今天的专辑；force 为真时换下一张（「换一张」）。 */
async function daily(force) {
  const day = today();
  const slugs = pool().map((a) => a.slug);
  let state = ctx.globalState.get(STATE_KEY);
  if (!state || !Array.isArray(state.bag)) state = null;
  if (state && state.date === day && !force && slugs.includes(state.slug)) return state.slug;
  let slug;
  let bag = (state?.bag || []).filter((s) => slugs.includes(s));
  if (config().get('shuffle') === 'release-order') {
    const ordered = pool().slice().sort((a, b) => (a.year || 0) - (b.year || 0)).map((a) => a.slug);
    const index = ordered.indexOf(state?.slug);
    slug = ordered[(index + 1) % ordered.length];
  } else if (!state && slugs.includes('yehuimei')) {
    slug = 'yehuimei';
    bag = shuffle(slugs.filter((s) => s !== slug));
  } else {
    if (!bag.length) bag = shuffle(slugs);
    if (bag[0] === state?.slug && bag.length > 1) [bag[0], bag[1]] = [bag[1], bag[0]];
    slug = bag.shift();
  }
  await ctx.globalState.update(STATE_KEY, { date: day, slug, bag });
  return slug;
}

async function effective() {
  const override = ctx.globalState.get(OVERRIDE_KEY, '');
  return override && findAlbum(override) ? override : daily(false);
}

// ── 切主题 ───────────────────────────────────────────────

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function setGlobal(section, key, value) {
  const configuration = vscode.workspace.getConfiguration(section);
  if (stable(configuration.inspect(key)?.globalValue) !== stable(value)) {
    await configuration.update(key, value, vscode.ConfigurationTarget.Global);
  }
}

function currentIsDark() {
  const name = currentTheme();
  const album = albumForTheme(name);
  if (album) return album.dark === name;
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
}

/**
 * 自定义专辑的颜色写进空位主题的作用域（官方的 [主题名] 覆盖，即时生效）。
 * 只写当前这一张，别的空位作用域清掉，免得 settings.json 越写越大。
 */
async function writeCustomColors(album) {
  const scoped = (current, make) => {
    const next = Object.fromEntries(Object.entries(current || {})
      .filter(([key]) => !(key.startsWith('[') && SLOT_LABELS.has(key.slice(1, -1)))));
    for (const mode of ['light', 'dark']) {
      const theme = buildTheme(album.palettes[mode], mode, album[mode]);
      next[`[${album[mode]}]`] = make(theme);
    }
    return next;
  };
  const workbench = vscode.workspace.getConfiguration('workbench').inspect('colorCustomizations')?.globalValue;
  const editor = vscode.workspace.getConfiguration('editor');
  const tokens = editor.inspect('tokenColorCustomizations')?.globalValue;
  const semantic = editor.inspect('semanticTokenColorCustomizations')?.globalValue;
  await setGlobal('workbench', 'colorCustomizations', scoped(workbench, (t) => t.colors));
  await setGlobal('editor', 'tokenColorCustomizations', scoped(tokens, (t) => ({ textMateRules: t.tokenColors })));
  await setGlobal('editor', 'semanticTokenColorCustomizations',
    scoped(semantic, (t) => ({ enabled: true, rules: t.semanticTokenColors })));
}

async function apply(slug, dark = currentIsDark()) {
  const album = findAlbum(slug);
  if (!album) return;
  if (album.custom) await writeCustomColors(album);
  // 跟随系统外观时 VS Code 用 preferred*，两边都写上。
  await setGlobal('workbench', 'preferredDarkColorTheme', album.dark);
  await setGlobal('workbench', 'preferredLightColorTheme', album.light);
  await setGlobal('workbench', 'colorTheme', dark ? album.dark : album.light);
}

// ── 封面 ─────────────────────────────────────────────────

/** VS Code 给 .monaco-workbench 加的主题 class，规则同 workbench 源码里的 fromExtensionTheme。 */
function themeClass(themePath) {
  let name = `${ctx.extension.id}-${themePath.replace(/^\.\//, '')}`.replace(/[^_a-zA-Z0-9-]/g, '-');
  if (/^[0-9-]/.test(name)) name = `_${name}`;
  return name;
}

const fileUrl = (file) => pathToFileURL(file).href.replace('file://', 'vscode-file://vscode-app');

/** 封面文件：内置专辑按 slug，自定义专辑按空位（换专辑只换文件，CSS 规则不变）。 */
function coverFile(album) {
  return path.join(coverDir(), album.custom ? `slot-${slotKey(album.slot)}.jpg` : `${album.slug}.jpg`);
}

function thumbFile(album) {
  return path.join(coverDir(), `${album.custom ? `c-${album.itunesId}` : album.slug}-thumb.jpg`);
}

/**
 * 换封面不重载：借 background 扩展的自定义样式，塞进「主题 class → 封面」的 CSS 规则。
 * 规则只跟内置专辑、空位和透明度有关；加删自定义专辑不改规则。
 * 每条规则都要求状态栏专辑名在 DOM 里：低调模式隐藏它，封面跟着即时消失。
 */
function coverConfig() {
  const settings = config();
  const opacity = resolveBackgroundOpacity({
    backgroundOpacity: settings.get('backgroundOpacity'),
    backgroundOpacityDark: settings.get('backgroundOpacityDark'),
    backgroundOpacityLight: settings.get('backgroundOpacityLight'),
  });
  const gate = `:has([id="${ctx.extension.id}.albumSkins.title"])`;
  const themes = ctx.extension.packageJSON.contributes.themes;
  const classOf = new Map(themes.map((t) => [t.label, themeClass(t.path)]));
  const covers = [
    ...manifest.builtin.map((a) => ({ album: a, file: path.join(coverDir(), `${a.slug}.jpg`) })),
    ...manifest.slots.map((slot, i) => ({ album: slot, file: path.join(coverDir(), `slot-${slotKey(i)}.jpg`) })),
  ];
  const rules = covers.flatMap(({ album, file }) => ['light', 'dark'].flatMap((mode) => {
    const scope = `body:has(> .monaco-workbench.${classOf.get(album[mode])})${gate}`;
    const url = fileUrl(file);
    return `${scope}::after{background-image:url(${url}) !important;opacity:${opacity[mode]} !important}`;
  }));
  // 值里先闭合 body::after，再接各条规则，最后重开一个 body::after 接住插件追加的兜底图（透明 1px）。
  const inject = `0}${rules.join('')}body::after{--album-skins-end:0`;
  return {
    images: [TRANSPARENT], opacity: opacity.dark, size: 'auto 100%', position: 'right center',
    styles: [{ '-webkit-mask-image': FADE, 'mask-image': FADE, '--album-skins': inject }], interval: 0, random: false,
  };
}

/** 从 iTunes 下载内置专辑缺的封面；thumbsOnly 时只下列表里用的小图。 */
async function downloadBuiltinCovers(thumbsOnly) {
  const missing = manifest.builtin.filter((a) => !fs.existsSync(thumbFile(a))
    || (!thumbsOnly && !fs.existsSync(coverFile(a))));
  if (!missing.length) return true;
  fs.mkdirSync(coverDir(), { recursive: true });
  const work = async (progress) => {
    const artwork = await itunes.lookupArtwork(missing.map((a) => a.itunesId));
    for (const album of missing) {
      progress?.report({ message: album.title, increment: 100 / missing.length });
      const small = artwork.get(album.itunesId);
      if (!small) throw new Error(`iTunes 上找不到《${album.title}》`);
      if (!fs.existsSync(thumbFile(album))) await itunes.download(itunes.artworkUrl(small, 96), thumbFile(album));
      if (!thumbsOnly) await itunes.download(itunes.artworkUrl(small, 1200), coverFile(album));
    }
  };
  try {
    if (thumbsOnly) await work();
    else await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '正在从 iTunes 下载专辑封面' }, work);
    return true;
  } catch (error) {
    if (!thumbsOnly) vscode.window.showErrorMessage(`专辑封面下载失败：${error.message}。检查网络后重新打开「albumSkins.syncBackground」。`);
    return false;
  }
}

async function applyCover() {
  const extension = vscode.extensions.getExtension('shalldie.background');
  if (!extension) {
    const install = '去安装';
    const choice = await vscode.window.showWarningMessage('渐隐封面需要先安装 background 扩展（shalldie.background）。', install);
    if (choice === install) vscode.commands.executeCommand('workbench.extensions.search', 'shalldie.background');
    return;
  }
  if (!(await downloadBuiltinCovers(false))) return;
  // 两个扩展都在启动完成后激活；它的配置监听要等它初始化完才注册，先写配置它会漏掉，界面停在旧补丁上。
  // 等它激活完再写，它才会照常提示「Apply and Reload」。
  await extension.activate();
  const background = vscode.workspace.getConfiguration('background');
  const fullscreen = background.inspect('fullscreen')?.globalValue || {};
  const desired = coverConfig();
  if (stable(fullscreen) === stable(desired)) return;
  // 第一次接管：记下原来的背景，关掉封面时还原（旧版本自己写的注入不算原背景）。之后由 background 扩展提示重载。
  const ours = MARKERS.some((marker) => JSON.stringify(fullscreen).includes(marker));
  if (!ours && !ctx.globalState.get(PREVIOUS_BACKGROUND_KEY)) await ctx.globalState.update(PREVIOUS_BACKGROUND_KEY, fullscreen);
  await background.update('fullscreen', desired, vscode.ConfigurationTarget.Global);
}

async function restoreBackground() {
  const previous = ctx.globalState.get(PREVIOUS_BACKGROUND_KEY);
  await vscode.workspace.getConfiguration('background').update('fullscreen', previous || undefined, vscode.ConfigurationTarget.Global);
  await ctx.globalState.update(PREVIOUS_BACKGROUND_KEY, undefined);
}

// ── 跟随系统外观 ─────────────────────────────────────────

async function syncAppearance() {
  const window = vscode.workspace.getConfiguration('window');
  const saved = ctx.globalState.get(PREVIOUS_AUTODETECT_KEY);
  if (config().get('followSystemAppearance')) {
    if (window.get('autoDetectColorScheme') === true) return;
    await ctx.globalState.update(PREVIOUS_AUTODETECT_KEY, { value: window.inspect('autoDetectColorScheme')?.globalValue ?? null });
    await window.update('autoDetectColorScheme', true, vscode.ConfigurationTarget.Global);
  } else if (saved) {
    await window.update('autoDetectColorScheme', saved.value ?? undefined, vscode.ConfigurationTarget.Global);
    await ctx.globalState.update(PREVIOUS_AUTODETECT_KEY, undefined);
  }
}

// ── 自定义专辑 ───────────────────────────────────────────

async function removeCustom(slug) {
  const list = loadCustom();
  const album = list.find((a) => a.slug === slug);
  if (!album) return;
  saveCustom(list.filter((a) => a.slug !== slug));
  for (const file of [coverFile({ ...album, custom: true }), thumbFile({ ...album, custom: true })]) fs.rmSync(file, { force: true });
  for (const key of ['favorites', 'excluded']) {
    const values = config().get(key);
    if (values.includes(slug)) await config().update(key, values.filter((s) => s !== slug), vscode.ConfigurationTarget.Global);
  }
  if (ctx.globalState.get(OVERRIDE_KEY) === slug) await ctx.globalState.update(OVERRIDE_KEY, '');
}

/** 边打边搜的专辑选择框。iTunes 每分钟只让查二十来次，所以停手半秒才搜，搜过的词不再搜。 */
function searchAlbum() {
  return new Promise((resolve) => {
    const box = vscode.window.createQuickPick();
    box.title = '添加专辑';
    box.placeholder = '歌手、专辑名、歌名都行，中文就可以：霉霉、林俊杰、晴天';
    // VS Code 默认把标题含输入文字的项挪到最前（一堆叫《晴天》的单曲会压过葉惠美），关掉，保持 iTunes 的顺序。
    box.sortByLabel = false;
    const cache = new Map();
    let timer;
    let latest = 0;
    let chosen;
    const note = (label, description) => [{ label, description, alwaysShow: true }];
    box.onDidChangeValue((value) => {
      clearTimeout(timer);
      const term = value.trim();
      box.busy = !!term;
      if (!term) {
        box.items = [];
        return;
      }
      timer = setTimeout(async () => {
        const mine = ++latest;
        let items;
        try {
          if (!cache.has(term)) cache.set(term, itunes.search(term));
          const results = await cache.get(term);
          // alwaysShow：结果是 iTunes 挑的，别让 VS Code 再按输入框文字把「含《晴天》」的葉惠美滤掉。
          items = results.length ? results.map((album) => ({
            label: album.title,
            description: [album.artist, album.year, album.song && `含《${album.song}》`].filter(Boolean).join(' · '),
            iconPath: vscode.Uri.parse(itunes.artworkUrl(album.artwork, 60)),
            alwaysShow: true, album,
          })) : note(`没搜到「${term}」`, '换个说法：歌手名、专辑名或其中一首歌');
        } catch (error) {
          cache.delete(term);
          items = error.rateLimited ? note('搜得太快，iTunes 让歇一会儿', '过十几秒再改一下关键词')
            : note(`搜索失败：${error.message}`, '检查一下网络');
        }
        if (mine !== latest) return;
        box.busy = false;
        box.items = items;
      }, 500);
    });
    box.onDidAccept(() => {
      chosen = box.selectedItems[0]?.album;
      if (chosen) box.hide();
    });
    box.onDidHide(() => {
      clearTimeout(timer);
      box.dispose();
      resolve(chosen);
    });
    box.show();
  });
}

async function addAlbum(refresh) {
  const picked = await searchAlbum();
  if (!picked) return;
  const existing = albums().find((a) => a.itunesId === picked.itunesId);
  if (existing) {
    await ctx.globalState.update(OVERRIDE_KEY, existing.slug);
    await refresh(true);
    vscode.window.showInformationMessage(`《${existing.title}》已经在列表里了，已切换过去。`);
    return;
  }
  const list = loadCustom();
  const used = new Set(list.map((a) => a.slot));
  const slot = manifest.slots.findIndex((_, i) => !used.has(i));
  if (slot < 0) {
    vscode.window.showWarningMessage(`自定义专辑最多 ${manifest.slots.length} 张，先在「选专辑」里删掉一张（🗑 按钮）。`);
    return;
  }
  const album = {
    slug: `c-${picked.itunesId}`, title: picked.title, artist: picked.artist, year: picked.year,
    itunesId: picked.itunesId, slot,
  };
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `正在给《${album.title}》取色` }, async () => {
      const { pixels } = decodePng(await itunes.fetchBuffer(itunes.artworkUrl(picked.artwork, 32, 'png')));
      Object.assign(album, generate(pixels));
      fs.mkdirSync(coverDir(), { recursive: true });
      const full = { ...album, custom: true };
      await itunes.download(itunes.artworkUrl(picked.artwork, 96), thumbFile(full));
      await itunes.download(itunes.artworkUrl(picked.artwork, 1200), coverFile(full));
    });
  } catch (error) {
    vscode.window.showErrorMessage(`取色失败：${error.message}`);
    return;
  }
  const before = currentTheme();
  saveCustom([...list, album]);
  await apply(album.slug);
  const keep = await vscode.window.showQuickPick([
    { label: '$(check) 保留这张', keep: true }, { label: '$(close) 放弃', keep: false },
  ], { placeHolder: `《${album.title}》的配色已经换上（封面自动取色），保留吗？`, ignoreFocusOut: true });
  if (keep?.keep) {
    await ctx.globalState.update(OVERRIDE_KEY, album.slug);
    await refresh(true);
    return;
  }
  await removeCustom(album.slug);
  const previous = albumForTheme(before);
  if (previous) await apply(previous.slug, previous.dark === before);
  else await setGlobal('workbench', 'colorTheme', before);
  await refresh(false);
}

// ── 激活 ─────────────────────────────────────────────────

function activate(context) {
  ctx = context;
  // 专辑名用金色。id 固定：封面 CSS 靠这个元素在不在判断低调模式。
  const title = vscode.window.createStatusBarItem('albumSkins.title', vscode.StatusBarAlignment.Right, 1001);
  title.name = '专辑皮肤';
  title.command = 'albumSkins.pick';
  title.color = new vscode.ThemeColor('albumSkins.title');
  context.subscriptions.push(title);

  // 低调模式一键开关。id 必须不含 albumSkins.title 子串，否则封面 CSS 的精确选择器会误命中，低调下封面会泄漏。
  const toggle = vscode.window.createStatusBarItem('albumSkins.toggle', vscode.StatusBarAlignment.Right, 1000);
  toggle.name = '专辑皮肤：低调模式';
  toggle.command = 'albumSkins.toggleDiscreet';
  context.subscriptions.push(toggle);

  function render() {
    // toggle 始终显示：低调模式下专辑名 title 会 hide()，但开关要一直在，否则无法再切回来。
    const discreet = config().get('discreet');
    toggle.text = discreet ? '$(eye-closed)' : '$(eye)';
    toggle.tooltip = discreet ? '低调模式已开，点击恢复专辑名与封面' : '点击进入低调模式（隐藏专辑名和封面）';
    toggle.show();

    const album = albumForTheme(currentTheme());
    if (!album || discreet) {
      title.hide();
      return;
    }
    title.text = `$(music) ${album.title}`;
    title.accessibilityInformation = { label: `专辑：${album.title}，${album.artist}` };
    title.show();
  }

  async function refresh(force) {
    // 只有正在用本扩展的主题（或第一次装）时才自动换，用户换成别的主题就不再打扰。
    const first = !context.globalState.get(SEEN_KEY);
    if (!force && !first && !isOurTheme(currentTheme())) return render();
    if (!force && !first && !config().get('dailyShuffle') && !context.globalState.get(OVERRIDE_KEY)) return render();
    await context.globalState.update(SEEN_KEY, true);
    await apply(await effective());
    render();
  }

  async function toggleList(key, slug) {
    const values = config().get(key);
    const next = values.includes(slug) ? values.filter((s) => s !== slug) : [...values, slug];
    await config().update(key, next, vscode.ConfigurationTarget.Global);
  }

  async function pickOpacity() {
    const mode = currentIsDark() ? 'Dark' : 'Light';
    const picked = await vscode.window.showQuickPick([
      { label: '自动', description: '当前主题继承通用设置；默认深色 30%、浅色 22%', value: null },
      ...[0.12, 0.22, 0.30, 0.45, 0.6].map((value) => ({
        label: `${Math.round(value * 100)}%`, value,
      })),
    ], { placeHolder: `调整${mode === 'Dark' ? '深色' : '浅色'}主题背景透明度（数值越大越明显）` });
    if (picked) await config().update(`backgroundOpacity${mode}`, picked.value, vscode.ConfigurationTarget.Global);
  }

  async function pick() {
    const override = context.globalState.get(OVERRIDE_KEY, '');
    const todays = findAlbum(await daily(false));
    const original = { theme: currentTheme(), dark: currentIsDark() };
    const quickPick = vscode.window.createQuickPick();
    quickPick.placeholder = '选一张专辑（上下移动即可预览，Esc 取消）';
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    const button = (icon, tooltip, action) => ({ iconPath: new vscode.ThemeIcon(icon), tooltip, action });
    const items = () => {
      const favorites = new Set(config().get('favorites'));
      const excluded = new Set(config().get('excluded'));
      const row = (a) => ({
        label: `${favorites.has(a.slug) ? '★ ' : ''}${a.title}`,
        description: [a.custom ? a.artist : '', a.year, excluded.has(a.slug) ? '不参与随机' : '', override === a.slug ? '✓ 当前' : '']
          .filter(Boolean).join(' · '),
        detail: a.custom ? undefined : a.mood,
        iconPath: fs.existsSync(thumbFile(a)) ? vscode.Uri.file(thumbFile(a)) : new vscode.ThemeIcon('music'),
        slug: a.slug,
        buttons: [
          button(favorites.has(a.slug) ? 'star-full' : 'star-empty', favorites.has(a.slug) ? '取消收藏' : '收藏', 'favorite'),
          button(excluded.has(a.slug) ? 'eye-closed' : 'circle-slash', excluded.has(a.slug) ? '恢复参与每日随机' : '不参与每日随机', 'exclude'),
          ...(a.custom ? [button('trash', '删除这张专辑', 'remove')] : []),
        ],
      });
      const all = albums();
      const builtin = all.filter((a) => !a.custom);
      const custom = all.filter((a) => a.custom);
      return [
        { label: '每日随机', description: `${override ? '' : '✓ '}今天是《${todays?.title}》`, iconPath: new vscode.ThemeIcon('calendar'), slug: '' },
        { label: '添加专辑…', description: '搜任意专辑，用封面自动取色', iconPath: new vscode.ThemeIcon('add'), action: 'add' },
        { label: '调整背景透明度…', description: '当前深浅主题的封面预设', iconPath: new vscode.ThemeIcon('settings-gear'), action: 'opacity' },
        { label: builtin[0]?.artist || '内置', kind: vscode.QuickPickItemKind.Separator },
        ...builtin.map(row),
        ...(custom.length ? [{ label: '我加的专辑', kind: vscode.QuickPickItemKind.Separator }, ...custom.map(row)] : []),
      ];
    };
    quickPick.items = items();
    let accepted = false;
    let timer;
    quickPick.onDidChangeActive(([item]) => {
      clearTimeout(timer);
      if (!item || item.action) return;
      timer = setTimeout(() => apply(item.slug || todays?.slug, original.dark), 150);
    });
    quickPick.onDidTriggerItemButton(async ({ item, button: { action } }) => {
      if (action === 'favorite') await toggleList('favorites', item.slug);
      if (action === 'exclude') await toggleList('excluded', item.slug);
      if (action === 'remove') await removeCustom(item.slug);
      quickPick.items = items();
      const same = quickPick.items.find((i) => i.slug === item.slug);
      if (same) quickPick.activeItems = [same];
    });
    quickPick.onDidAccept(async () => {
      const [item] = quickPick.activeItems;
      if (!item) return;
      accepted = true;
      quickPick.hide();
      clearTimeout(timer);
      if (item.action === 'opacity') {
        // 列表可能已预览其他专辑，先还原再调整，不改变手动选择。
        await setGlobal('workbench', 'colorTheme', original.theme);
        await pickOpacity();
        return;
      }
      if (item.action === 'add') {
        await addAlbum(refresh);
        return;
      }
      await context.globalState.update(OVERRIDE_KEY, item.slug);
      await apply(item.slug || (await effective()), original.dark);
      render();
    });
    quickPick.onDidHide(async () => {
      clearTimeout(timer);
      quickPick.dispose();
      if (accepted) return;
      const album = albumForTheme(original.theme);
      if (album) await apply(album.slug, original.dark);
      else await setGlobal('workbench', 'colorTheme', original.theme);
    });
    quickPick.show();
    // 光标先停在当前专辑上，否则默认选中第一项「每日随机」会立刻把主题预览成今天的随机专辑。
    const current = albumForTheme(original.theme);
    const start = quickPick.items.find((i) => i.slug && i.slug === current?.slug);
    if (start) quickPick.activeItems = [start];
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('albumSkins.pick', pick),
    vscode.commands.registerCommand('albumSkins.next', async () => {
      await context.globalState.update(OVERRIDE_KEY, '');
      await daily(true);
      await refresh(true);
    }),
    vscode.commands.registerCommand('albumSkins.daily', async () => {
      await context.globalState.update(OVERRIDE_KEY, '');
      await refresh(true);
    }),
    vscode.commands.registerCommand('albumSkins.add', () => addAlbum(refresh)),
    vscode.commands.registerCommand('albumSkins.toggleDiscreet', async () => {
      const on = !config().get('discreet');
      await config().update('discreet', on, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(on ? '低调模式已开：专辑名和封面已隐藏' : '低调模式已关', 3000);
    }),
    vscode.window.onDidChangeActiveColorTheme(render),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration('albumSkins.discreet')) render();
      if (event.affectsConfiguration('albumSkins.followSystemAppearance')) await syncAppearance();
      const syncChanged = event.affectsConfiguration('albumSkins.syncBackground');
      const opacityChanged = ['backgroundOpacity', 'backgroundOpacityDark', 'backgroundOpacityLight']
        .some((key) => event.affectsConfiguration(`albumSkins.${key}`));
      if (syncChanged || opacityChanged) {
        if (config().get('syncBackground')) await applyCover();
        else if (syncChanged) await restoreBackground();
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

  syncAppearance();
  if (config().get('syncBackground')) applyCover();
  else downloadBuiltinCovers(true);
  refresh(false);
}

function deactivate() {}

module.exports = { activate, deactivate };
