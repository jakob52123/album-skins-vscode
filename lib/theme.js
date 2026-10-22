// 17 个界面颜色 → 完整 VS Code 主题。内置专辑（构建时）和用户自加专辑（运行时）共用这一份映射。
'use strict';
const { alpha, contrast, fromHls, mix, readable, rgb, rgbToHls, rgbaToHex } = require('./color');

const PALETTE_KEYS = [
  'bg', 'bg-panel', 'bg-hover', 'bg-selected', 'border', 'text', 'text-muted', 'text-dim', 'accent',
  'accent-hover', 'user-bg', 'assistant-bg', 'tool-bg', 'bg-subtle', 'gold', 'terracotta', 'on-accent',
];

// 与 v1 的 check_contrast.py 相同的阈值；palette.generate 和测试都按它检查。
const CONTRAST_RULES = [
  ['text', 'bg', 7], ['text', 'bg-panel', 7], ['text', 'user-bg', 7], ['text', 'tool-bg', 7],
  ['text-muted', 'bg', 4.5], ['text-dim', 'bg', 3], ['accent', 'bg', 3], ['on-accent', 'accent', 4.5],
];

// 空位主题在用户还没放专辑时的中性配色（冷灰蓝）。
const NEUTRAL = {
  light: {
    bg: '#f4f5f6', 'bg-panel': '#e8eaec', 'bg-hover': '#dcdfe2', 'bg-selected': '#ccd1d6', border: '#b9c0c7',
    text: '#1d2329', 'text-muted': '#4f5a64', 'text-dim': '#6c7782', accent: '#3f6f95', 'accent-hover': '#39668a',
    'user-bg': '#e2e5e8', 'assistant-bg': '#f4f5f6', 'tool-bg': '#eceef0', 'bg-subtle': 'rgba(63,111,149,.06)',
    gold: '#b08a2a', terracotta: '#c9703f', 'on-accent': '#ffffff',
  },
  dark: {
    bg: '#15191d', 'bg-panel': '#1d2227', 'bg-hover': '#272d33', 'bg-selected': '#323a41', border: '#3f4850',
    text: '#e6eaee', 'text-muted': '#aab4bd', 'text-dim': '#85909a', accent: '#8fb7d9', 'accent-hover': '#9cc1e0',
    'user-bg': '#20262b', 'assistant-bg': '#15191d', 'tool-bg': '#1a1f23', 'bg-subtle': 'rgba(143,183,217,.06)',
    gold: '#d59432', terracotta: '#d1774b', 'on-accent': '#15191d',
  },
};

function syntaxColors(p) {
  const bg = p.bg;
  return {
    keyword: readable(p.accent, bg, 4.5),
    func: readable(p.gold, bg, 4.5),
    string: readable(p.terracotta, bg, 4.5),
    number: readable(mix(p.gold, p.terracotta), bg, 4.5),
    kind: readable(mix(p.accent, p.gold, 0.4), bg, 4.5),
    comment: readable(p['text-dim'], bg, 3.2),
    punctuation: readable(p['text-muted'], bg, 4.5),
  };
}

function syntax(p) {
  const { keyword, func, string, number, kind, comment, punctuation } = syntaxColors(p);
  const rules = [
    [['comment', 'punctuation.definition.comment'], comment, 'italic'],
    [['keyword', 'storage', 'keyword.operator.new', 'keyword.control'], keyword, ''],
    [['keyword.operator', 'punctuation', 'meta.brace'], punctuation, ''],
    [['string', 'string.quoted', 'string.template', 'markup.inline.raw'], string, ''],
    [['constant.numeric', 'constant.language', 'constant.character', 'support.constant',
      'variable.other.constant', 'variable.other.enummember'], number, ''],
    [['entity.name.function', 'support.function', 'meta.function-call', 'entity.other.attribute-name'], func, ''],
    [['entity.name.type', 'entity.name.class', 'support.type', 'support.class',
      'entity.other.inherited-class', 'storage.type.primitive'], kind, ''],
    [['entity.name.tag', 'meta.tag'], keyword, ''],
    [['variable', 'meta.definition.variable', 'variable.parameter'], p.text, ''],
    [['variable.language', 'variable.parameter.function.language.special'], keyword, 'italic'],
    [['markup.heading', 'entity.name.section'], keyword, 'bold'],
    [['markup.bold'], p.text, 'bold'],
    [['markup.italic'], p.text, 'italic'],
    [['markup.underline.link', 'string.other.link'], func, ''],
    [['markup.quote'], comment, 'italic'],
    [['markup.inserted'], keyword, ''],
    [['markup.deleted'], string, ''],
    [['invalid'], string, 'underline'],
  ];
  const tokenColors = rules.map(([scope, foreground, fontStyle]) => (
    { scope, settings: fontStyle ? { foreground, fontStyle } : { foreground } }));
  const semantic = {
    function: func, method: func, class: kind, type: kind, interface: kind,
    enum: kind, enumMember: number, namespace: kind, keyword,
    parameter: p.text, property: p.text, 'variable.readonly': number, comment,
    string, number, decorator: func, macro: func,
  };
  return { tokenColors, semantic };
}

/** 终端 16 色：六个彩色固定色相，饱和度、明度跟随专辑 accent，再保证在背景上看得清。 */
function terminal(p, dark) {
  const [, accentL, accentS] = rgbToHls(...rgb(p.accent));
  const s = Math.min(0.7, Math.max(0.35, accentS));
  const hues = { Red: 0, Yellow: 45, Green: 130, Cyan: 180, Blue: 215, Magenta: 300 };
  const colors = {};
  for (const [name, hue] of Object.entries(hues)) {
    colors[`terminal.ansi${name}`] = readable(fromHls(hue, accentL, s), p.bg, 4.5);
    colors[`terminal.ansiBright${name}`] = readable(fromHls(hue, dark ? accentL + 0.1 : accentL - 0.1, s), p.bg, 4.5);
  }
  if (dark) {
    Object.assign(colors, {
      'terminal.ansiBlack': p['bg-selected'], 'terminal.ansiBrightBlack': readable(p['text-dim'], p.bg, 3),
      'terminal.ansiWhite': p['text-muted'], 'terminal.ansiBrightWhite': p.text,
    });
  } else {
    Object.assign(colors, {
      'terminal.ansiBlack': p.text, 'terminal.ansiBrightBlack': p['text-muted'],
      'terminal.ansiWhite': p['text-dim'], 'terminal.ansiBrightWhite': p.border,
    });
  }
  return colors;
}

/** 括号彩虹色、Error Lens、波浪线：此前沿用 VS Code 默认亮色，与专辑色不搭。 */
function extras(p) {
  const { keyword, func, string, number, kind, punctuation } = syntaxColors(p);
  const error = readable(p.terracotta, p.bg, 4.5);
  const warning = readable(p.gold, p.bg, 4.5);
  const info = readable(p.accent, p.bg, 4.5);
  const hint = readable(p['text-dim'], p.bg, 3.2);
  return {
    'editorBracketHighlight.foreground1': keyword, 'editorBracketHighlight.foreground2': func,
    'editorBracketHighlight.foreground3': string, 'editorBracketHighlight.foreground4': kind,
    'editorBracketHighlight.foreground5': number, 'editorBracketHighlight.foreground6': punctuation,
    'editorBracketHighlight.unexpectedBracket.foreground': error,
    'editorError.foreground': error, 'editorWarning.foreground': warning, 'editorInfo.foreground': info,
    'errorLens.errorForeground': error, 'errorLens.errorBackground': alpha(error, 0.1),
    'errorLens.warningForeground': warning, 'errorLens.warningBackground': alpha(warning, 0.1),
    'errorLens.infoForeground': info, 'errorLens.infoBackground': alpha(info, 0.1),
    'errorLens.hintForeground': hint, 'errorLens.hintBackground': alpha(hint, 0.1),
  };
}

function workbench(p, dark) {
  const { bg, text, gold, accent, border } = p;
  const panel = p['bg-panel'];
  const subtle = rgbaToHex(p['bg-subtle'], bg);
  const onAccent = p['on-accent'];
  const muted = p['text-muted'];
  const dim = p['text-dim'];
  return {
    foreground: text, descriptionForeground: muted, disabledForeground: dim,
    focusBorder: gold, 'selection.background': alpha(accent, 0.3),
    'widget.border': border, 'widget.shadow': dark ? '#00000040' : '#0000001a',
    'icon.foreground': muted, 'sash.hoverBorder': gold, 'textLink.foreground': accent,
    'textLink.activeForeground': p['accent-hover'], 'textPreformat.foreground': p.terracotta,
    'textPreformat.background': p['tool-bg'], 'textBlockQuote.background': p['tool-bg'],
    'textBlockQuote.border': gold, 'textCodeBlock.background': p['tool-bg'],
    // 编辑器
    'editor.background': bg, 'editor.foreground': text,
    'editorLineNumber.foreground': dim, 'editorLineNumber.activeForeground': muted,
    'editorCursor.foreground': gold, 'editor.lineHighlightBackground': subtle,
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': alpha(accent, 0.28), 'editor.inactiveSelectionBackground': alpha(accent, 0.16),
    'editor.selectionHighlightBackground': alpha(accent, 0.14),
    'editor.wordHighlightBackground': alpha(accent, 0.14), 'editor.wordHighlightStrongBackground': alpha(gold, 0.2),
    'editor.findMatchBackground': alpha(gold, 0.45), 'editor.findMatchHighlightBackground': alpha(gold, 0.22),
    'editor.findMatchBorder': gold, 'editorBracketMatch.background': alpha(gold, 0.18),
    'editorBracketMatch.border': gold, 'editorIndentGuide.background1': alpha(border, 0.55),
    'editorIndentGuide.activeBackground1': border, 'editorWhitespace.foreground': alpha(dim, 0.4),
    'editorRuler.foreground': alpha(border, 0.7), 'editorLink.activeForeground': accent,
    'editorWidget.background': panel, 'editorWidget.border': border, 'editorWidget.foreground': text,
    'editorHoverWidget.background': panel, 'editorHoverWidget.border': border,
    'editorSuggestWidget.background': panel, 'editorSuggestWidget.border': border,
    'editorSuggestWidget.selectedBackground': p['bg-selected'], 'editorSuggestWidget.highlightForeground': accent,
    'editorGutter.addedBackground': accent, 'editorGutter.modifiedBackground': gold,
    'editorGutter.deletedBackground': p.terracotta,
    'editorOverviewRuler.border': '#00000000', 'editorGroup.border': border,
    'editorGroupHeader.tabsBackground': panel, 'editorGroupHeader.tabsBorder': border,
    'editorStickyScroll.background': bg, 'editorStickyScrollHover.background': p['bg-hover'],
    'breadcrumb.foreground': muted, 'breadcrumb.focusForeground': text, 'breadcrumb.background': bg,
    'diffEditor.insertedTextBackground': alpha(accent, 0.18), 'diffEditor.removedTextBackground': alpha(p.terracotta, 0.18),
    'peekView.border': gold, 'peekViewEditor.background': p['tool-bg'], 'peekViewResult.background': panel,
    'peekViewTitle.background': panel, 'peekViewEditor.matchHighlightBackground': alpha(gold, 0.35),
    'peekViewResult.matchHighlightBackground': alpha(gold, 0.35),
    'minimap.background': bg, 'minimapSlider.background': alpha(p['bg-selected'], 0.5),
    // 标签页：激活页顶部金线，对应 pi-web 顶栏细金线
    'tab.activeBackground': bg, 'tab.activeForeground': text, 'tab.inactiveBackground': panel,
    'tab.inactiveForeground': muted, 'tab.border': border, 'tab.activeBorderTop': gold,
    'tab.hoverBackground': p['bg-hover'], 'tab.unfocusedActiveForeground': muted,
    'tab.unfocusedInactiveForeground': dim, 'tab.lastPinnedBorder': border,
    // 外框
    'titleBar.activeBackground': panel, 'titleBar.activeForeground': text,
    'titleBar.inactiveBackground': panel, 'titleBar.inactiveForeground': dim, 'titleBar.border': gold,
    'activityBar.background': panel, 'activityBar.foreground': accent, 'activityBar.inactiveForeground': dim,
    'activityBar.border': border, 'activityBar.activeBorder': gold, 'activityBarBadge.background': accent,
    'activityBarBadge.foreground': onAccent, 'activityBarTop.foreground': accent,
    'activityBarTop.inactiveForeground': dim, 'activityBarTop.activeBorder': gold,
    'sideBar.background': panel, 'sideBar.foreground': text, 'sideBar.border': border,
    'sideBarTitle.foreground': muted, 'sideBarSectionHeader.background': panel,
    'sideBarSectionHeader.foreground': muted, 'sideBarSectionHeader.border': border,
    'panel.background': bg, 'panel.border': border, 'panelTitle.activeForeground': text,
    'panelTitle.inactiveForeground': dim, 'panelTitle.activeBorder': gold,
    'panelSectionHeader.background': panel, 'auxiliaryBar.background': panel,
    'statusBar.background': panel, 'statusBar.foreground': muted, 'statusBar.border': border,
    'statusBar.noFolderBackground': panel, 'statusBar.debuggingBackground': gold,
    'statusBar.debuggingForeground': bg, 'statusBarItem.hoverBackground': p['bg-hover'],
    'statusBarItem.remoteBackground': accent, 'statusBarItem.remoteForeground': onAccent,
    'statusBarItem.prominentBackground': p['bg-selected'],
    // 列表、树
    'list.hoverBackground': p['bg-hover'], 'list.hoverForeground': text,
    'list.activeSelectionBackground': p['bg-selected'], 'list.activeSelectionForeground': text,
    'list.inactiveSelectionBackground': p['bg-selected'], 'list.inactiveSelectionForeground': text,
    'list.focusOutline': gold, 'list.focusBackground': p['bg-selected'], 'list.highlightForeground': accent,
    'list.dropBackground': alpha(accent, 0.2), 'tree.indentGuidesStroke': border,
    // 控件
    'button.background': accent, 'button.foreground': onAccent, 'button.hoverBackground': p['accent-hover'],
    'button.secondaryBackground': p['bg-selected'], 'button.secondaryForeground': text,
    'button.secondaryHoverBackground': p['bg-hover'], 'button.border': '#00000000',
    'badge.background': accent, 'badge.foreground': onAccent,
    'input.background': p['tool-bg'], 'input.foreground': text, 'input.border': border,
    'input.placeholderForeground': dim, 'inputOption.activeBorder': gold,
    'inputOption.activeBackground': alpha(gold, 0.2), 'dropdown.background': p['tool-bg'],
    'dropdown.border': border, 'dropdown.foreground': text, 'checkbox.background': p['tool-bg'],
    'checkbox.border': border, 'progressBar.background': gold,
    'quickInput.background': panel, 'quickInput.foreground': text,
    'quickInputList.focusBackground': p['bg-selected'], 'quickInputList.focusForeground': text,
    'pickerGroup.foreground': accent, 'pickerGroup.border': border,
    'menu.background': panel, 'menu.foreground': text, 'menu.selectionBackground': p['bg-selected'],
    'menu.selectionForeground': text, 'menu.separatorBackground': border, 'menu.border': border,
    'notifications.background': panel, 'notifications.foreground': text, 'notifications.border': border,
    'notificationCenterHeader.background': panel, 'notificationLink.foreground': accent,
    'scrollbar.shadow': '#00000000', 'scrollbarSlider.background': alpha(p['bg-selected'], 0.7),
    'scrollbarSlider.hoverBackground': p['bg-selected'], 'scrollbarSlider.activeBackground': border,
    'keybindingLabel.background': p['tool-bg'], 'keybindingLabel.border': border,
    'keybindingLabel.foreground': text, 'settings.headerForeground': text,
    'settings.modifiedItemIndicator': gold, 'welcomePage.tileBackground': panel,
    'chat.requestBackground': p['user-bg'], 'chat.slashCommandBackground': alpha(accent, 0.18),
    'gitDecoration.modifiedResourceForeground': readable(gold, panel, 3),
    'gitDecoration.untrackedResourceForeground': readable(accent, panel, 3),
    'gitDecoration.addedResourceForeground': readable(accent, panel, 3),
    'gitDecoration.deletedResourceForeground': readable(p.terracotta, panel, 3),
    'gitDecoration.ignoredResourceForeground': dim,
    'terminal.background': bg, 'terminal.foreground': text, 'terminalCursor.foreground': gold,
    'terminal.selectionBackground': alpha(accent, 0.3), 'terminal.border': border,
    // 状态栏角标：专辑名用专辑金色
    'albumSkins.title': readable(gold, panel, 4.5),
    ...terminal(p, dark),
    ...extras(p),
  };
}

/** palette 的 17 个颜色 → 主题文件内容。mode 是 'light' 或 'dark'。 */
function buildTheme(palette, mode, name) {
  const { tokenColors, semantic } = syntax(palette);
  return {
    name, type: mode, semanticHighlighting: true,
    colors: workbench(palette, mode === 'dark'), tokenColors, semanticTokenColors: semantic,
  };
}

/** 不满足的对比度规则列表，空数组表示全部达标。 */
function contrastFailures(palette) {
  return CONTRAST_RULES.filter(([fg, bg, min]) => contrast(palette[fg], palette[bg]) < min)
    .map(([fg, bg, min]) => `${fg}/${bg} ${contrast(palette[fg], palette[bg]).toFixed(2)} < ${min}`);
}

module.exports = { PALETTE_KEYS, CONTRAST_RULES, NEUTRAL, buildTheme, contrastFailures };
