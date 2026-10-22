#!/usr/bin/env python3
"""从 data/albums.json 生成 VS Code 主题扩展：32 个主题、package.json、配色预览图。"""
import colorsys
import json
import shutil
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERSION = '1.0.0'
REPOSITORY = 'https://github.com/jakob52123/jay-album-vscode'


def rgb(color):
    color = color.removeprefix('#')
    return tuple(int(color[i:i + 2], 16) / 255 for i in (0, 2, 4))


def hexify(channels):
    return '#' + ''.join(f'{round(max(0, min(1, c)) * 255):02x}' for c in channels)


def luminance(color):
    linear = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb(color)]
    return sum(c * w for c, w in zip(linear, (.2126, .7152, .0722), strict=True))


def contrast(first, second):
    a, b = sorted((luminance(first), luminance(second)))
    return (b + .05) / (a + .05)


def mix(first, second, weight=.5):
    return hexify(a * (1 - weight) + b * weight for a, b in zip(rgb(first), rgb(second), strict=True))


def alpha(color, value):
    return f'{color}{round(value * 255):02x}'


def readable(color, background, target):
    """保持色相，只调明度直到对比度达标（浅底压暗、深底提亮）。"""
    h, lightness, s = colorsys.rgb_to_hls(*rgb(color))
    step = -.01 if luminance(background) > .5 else .01
    while contrast(color, background) < target and 0 < lightness < 1:
        lightness += step
        color = hexify(colorsys.hls_to_rgb(h, lightness, s))
    return color


def rgba_to_hex(value, background):
    """albums.json 里 bg-subtle 是 rgba()，VS Code 只认十六进制。"""
    if value.startswith('#'):
        return value
    r, g, b, a = (float(x) for x in value[value.find('(') + 1:-1].split(','))
    return mix(background, hexify((r / 255, g / 255, b / 255)), a)


def syntax(p):
    bg = p['bg']
    keyword = readable(p['accent'], bg, 4.5)
    function = readable(p['gold'], bg, 4.5)
    string = readable(p['terracotta'], bg, 4.5)
    number = readable(mix(p['gold'], p['terracotta']), bg, 4.5)
    kind = readable(mix(p['accent'], p['gold'], .4), bg, 4.5)
    comment = readable(p['text-dim'], bg, 3.2)
    punctuation = readable(p['text-muted'], bg, 4.5)
    rules = [
        (['comment', 'punctuation.definition.comment'], comment, 'italic'),
        (['keyword', 'storage', 'keyword.operator.new', 'keyword.control'], keyword, ''),
        (['keyword.operator', 'punctuation', 'meta.brace'], punctuation, ''),
        (['string', 'string.quoted', 'string.template', 'markup.inline.raw'], string, ''),
        (['constant.numeric', 'constant.language', 'constant.character', 'support.constant',
          'variable.other.constant', 'variable.other.enummember'], number, ''),
        (['entity.name.function', 'support.function', 'meta.function-call',
          'entity.other.attribute-name'], function, ''),
        (['entity.name.type', 'entity.name.class', 'support.type', 'support.class',
          'entity.other.inherited-class', 'storage.type.primitive'], kind, ''),
        (['entity.name.tag', 'meta.tag'], keyword, ''),
        (['variable', 'meta.definition.variable', 'variable.parameter'], p['text'], ''),
        (['variable.language', 'variable.parameter.function.language.special'], keyword, 'italic'),
        (['markup.heading', 'entity.name.section'], keyword, 'bold'),
        (['markup.bold'], p['text'], 'bold'),
        (['markup.italic'], p['text'], 'italic'),
        (['markup.underline.link', 'string.other.link'], function, ''),
        (['markup.quote'], comment, 'italic'),
        (['markup.inserted'], keyword, ''),
        (['markup.deleted'], string, ''),
        (['invalid'], string, 'underline'),
    ]
    token_colors = [{'scope': scope, 'settings': {'foreground': color, **({'fontStyle': style} if style else {})}}
                    for scope, color, style in rules]
    semantic = {
        'function': function, 'method': function, 'class': kind, 'type': kind, 'interface': kind,
        'enum': kind, 'enumMember': number, 'namespace': kind, 'keyword': keyword,
        'parameter': p['text'], 'property': p['text'], 'variable.readonly': number, 'comment': comment,
        'string': string, 'number': number, 'decorator': function, 'macro': function,
    }
    return token_colors, semantic


def workbench(p, dark):
    bg, panel, text = p['bg'], p['bg-panel'], p['text']
    subtle = rgba_to_hex(p['bg-subtle'], bg)
    accent, gold, on_accent = p['accent'], p['gold'], p['on-accent']
    muted, dim, border = p['text-muted'], p['text-dim'], p['border']
    return {
        'foreground': text, 'descriptionForeground': muted, 'disabledForeground': dim,
        'focusBorder': gold, 'contrastBorder': None, 'selection.background': alpha(accent, .3),
        'widget.border': border, 'widget.shadow': '#00000040' if dark else '#0000001a',
        'icon.foreground': muted, 'sash.hoverBorder': gold, 'textLink.foreground': accent,
        'textLink.activeForeground': p['accent-hover'], 'textPreformat.foreground': p['terracotta'],
        'textPreformat.background': p['tool-bg'], 'textBlockQuote.background': p['tool-bg'],
        'textBlockQuote.border': gold, 'textCodeBlock.background': p['tool-bg'],
        # 编辑器
        'editor.background': bg, 'editor.foreground': text,
        'editorLineNumber.foreground': dim, 'editorLineNumber.activeForeground': muted,
        'editorCursor.foreground': gold, 'editor.lineHighlightBackground': subtle,
        'editor.lineHighlightBorder': '#00000000',
        'editor.selectionBackground': alpha(accent, .28), 'editor.inactiveSelectionBackground': alpha(accent, .16),
        'editor.selectionHighlightBackground': alpha(accent, .14),
        'editor.wordHighlightBackground': alpha(accent, .14), 'editor.wordHighlightStrongBackground': alpha(gold, .2),
        'editor.findMatchBackground': alpha(gold, .45), 'editor.findMatchHighlightBackground': alpha(gold, .22),
        'editor.findMatchBorder': gold, 'editorBracketMatch.background': alpha(gold, .18),
        'editorBracketMatch.border': gold, 'editorIndentGuide.background1': alpha(border, .55),
        'editorIndentGuide.activeBackground1': border, 'editorWhitespace.foreground': alpha(dim, .4),
        'editorRuler.foreground': alpha(border, .7), 'editorLink.activeForeground': accent,
        'editorWidget.background': panel, 'editorWidget.border': border, 'editorWidget.foreground': text,
        'editorHoverWidget.background': panel, 'editorHoverWidget.border': border,
        'editorSuggestWidget.background': panel, 'editorSuggestWidget.border': border,
        'editorSuggestWidget.selectedBackground': p['bg-selected'], 'editorSuggestWidget.highlightForeground': accent,
        'editorGutter.addedBackground': accent, 'editorGutter.modifiedBackground': gold,
        'editorGutter.deletedBackground': p['terracotta'],
        'editorOverviewRuler.border': '#00000000', 'editorGroup.border': border,
        'editorGroupHeader.tabsBackground': panel, 'editorGroupHeader.tabsBorder': border,
        'editorStickyScroll.background': bg, 'editorStickyScrollHover.background': p['bg-hover'],
        'breadcrumb.foreground': muted, 'breadcrumb.focusForeground': text, 'breadcrumb.background': bg,
        'diffEditor.insertedTextBackground': alpha(accent, .18), 'diffEditor.removedTextBackground': alpha(p['terracotta'], .18),
        'peekView.border': gold, 'peekViewEditor.background': p['tool-bg'], 'peekViewResult.background': panel,
        'peekViewTitle.background': panel, 'peekViewEditor.matchHighlightBackground': alpha(gold, .35),
        'peekViewResult.matchHighlightBackground': alpha(gold, .35),
        'minimap.background': bg, 'minimapSlider.background': alpha(p['bg-selected'], .5),
        # 标签页：激活页顶部金线，对应 pi-web 顶栏细金线
        'tab.activeBackground': bg, 'tab.activeForeground': text, 'tab.inactiveBackground': panel,
        'tab.inactiveForeground': muted, 'tab.border': border, 'tab.activeBorderTop': gold,
        'tab.hoverBackground': p['bg-hover'], 'tab.unfocusedActiveForeground': muted,
        'tab.unfocusedInactiveForeground': dim, 'tab.lastPinnedBorder': border,
        # 外框
        'titleBar.activeBackground': panel, 'titleBar.activeForeground': text,
        'titleBar.inactiveBackground': panel, 'titleBar.inactiveForeground': dim, 'titleBar.border': gold,
        'activityBar.background': panel, 'activityBar.foreground': accent, 'activityBar.inactiveForeground': dim,
        'activityBar.border': border, 'activityBar.activeBorder': gold, 'activityBarBadge.background': accent,
        'activityBarBadge.foreground': on_accent, 'activityBarTop.foreground': accent,
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
        'statusBarItem.remoteBackground': accent, 'statusBarItem.remoteForeground': on_accent,
        'statusBarItem.prominentBackground': p['bg-selected'],
        # 列表、树
        'list.hoverBackground': p['bg-hover'], 'list.hoverForeground': text,
        'list.activeSelectionBackground': p['bg-selected'], 'list.activeSelectionForeground': text,
        'list.inactiveSelectionBackground': p['bg-selected'], 'list.inactiveSelectionForeground': text,
        'list.focusOutline': gold, 'list.focusBackground': p['bg-selected'], 'list.highlightForeground': accent,
        'list.dropBackground': alpha(accent, .2), 'tree.indentGuidesStroke': border,
        # 控件
        'button.background': accent, 'button.foreground': on_accent, 'button.hoverBackground': p['accent-hover'],
        'button.secondaryBackground': p['bg-selected'], 'button.secondaryForeground': text,
        'button.secondaryHoverBackground': p['bg-hover'], 'button.border': '#00000000',
        'badge.background': accent, 'badge.foreground': on_accent,
        'input.background': p['tool-bg'], 'input.foreground': text, 'input.border': border,
        'input.placeholderForeground': dim, 'inputOption.activeBorder': gold,
        'inputOption.activeBackground': alpha(gold, .2), 'dropdown.background': p['tool-bg'],
        'dropdown.border': border, 'dropdown.foreground': text, 'checkbox.background': p['tool-bg'],
        'checkbox.border': border, 'progressBar.background': gold,
        'quickInput.background': panel, 'quickInput.foreground': text,
        'quickInputList.focusBackground': p['bg-selected'], 'quickInputList.focusForeground': text,
        'pickerGroup.foreground': accent, 'pickerGroup.border': border,
        'menu.background': panel, 'menu.foreground': text, 'menu.selectionBackground': p['bg-selected'],
        'menu.selectionForeground': text, 'menu.separatorBackground': border, 'menu.border': border,
        'notifications.background': panel, 'notifications.foreground': text, 'notifications.border': border,
        'notificationCenterHeader.background': panel, 'notificationLink.foreground': accent,
        'scrollbar.shadow': '#00000000', 'scrollbarSlider.background': alpha(p['bg-selected'], .7),
        'scrollbarSlider.hoverBackground': p['bg-selected'], 'scrollbarSlider.activeBackground': p['border'],
        'keybindingLabel.background': p['tool-bg'], 'keybindingLabel.border': border,
        'keybindingLabel.foreground': text, 'settings.headerForeground': text,
        'settings.modifiedItemIndicator': gold, 'welcomePage.tileBackground': panel,
        'chat.requestBackground': p['user-bg'], 'chat.slashCommandBackground': alpha(accent, .18),
        'gitDecoration.modifiedResourceForeground': readable(gold, panel, 3),
        'gitDecoration.untrackedResourceForeground': readable(accent, panel, 3),
        'gitDecoration.addedResourceForeground': readable(accent, panel, 3),
        'gitDecoration.deletedResourceForeground': readable(p['terracotta'], panel, 3),
        'gitDecoration.ignoredResourceForeground': dim,
        'terminal.background': bg, 'terminal.foreground': text, 'terminalCursor.foreground': gold,
        'terminal.selectionBackground': alpha(accent, .3), 'terminal.border': border,
        # 状态栏角标：标题用专辑金色，年份压暗
        'jayAlbum.title': readable(gold, panel, 4.5), 'jayAlbum.year': readable(dim, panel, 3),
    }


def palettes_svg(albums):
    """README 用的配色预览：每张专辑浅/深两条色带，只有色块和文字，不含封面。"""
    keys = ('bg', 'bg-panel', 'bg-selected', 'border', 'text-muted', 'text', 'accent', 'gold', 'terracotta')
    cell, row_h, label_w, gap = 22, 30, 190, 14
    width = label_w + 2 * (len(keys) * cell + gap) + 10
    rows = []
    for i, album in enumerate(albums):
        y = 40 + i * row_h
        rows.append(f'<text x="10" y="{y + 16}" class="t">{escape(album["title"])}'
                    f'<tspan class="y"> {album["year"]}</tspan></text>')
        for m, mode in enumerate(('light', 'dark')):
            x0 = label_w + m * (len(keys) * cell + gap)
            for k, key in enumerate(keys):
                color = rgba_to_hex(album[mode][key], album[mode]['bg'])
                rows.append(f'<rect x="{x0 + k * cell}" y="{y}" width="{cell}" height="{row_h - 6}" fill="{color}"/>')
    height = 40 + len(albums) * row_h + 10
    head = (f'<text x="{label_w}" y="24" class="y">浅色</text>'
            f'<text x="{label_w + len(keys) * cell + gap}" y="24" class="y">深色</text>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">'
            '<style>.t{font:600 14px "PingFang SC","Noto Sans SC",sans-serif;fill:#8a7a5a}'
            '.y{font:400 12px "PingFang SC","Noto Sans SC",sans-serif;fill:#8a8a8a}</style>'
            + head + ''.join(rows) + '</svg>\n')


def theme_label(album, mode):
    return f"周杰伦 · {album['title']} {album['year']}（{'深' if mode == 'dark' else '浅'}）"


def main():
    albums = json.loads((ROOT / 'data' / 'albums.json').read_text())['albums']
    shutil.rmtree(ROOT / 'themes', ignore_errors=True)
    (ROOT / 'themes').mkdir()
    contributes, manifest = [], []
    for album in albums:
        for mode in ('light', 'dark'):
            p = album[mode]
            token_colors, semantic = syntax(p)
            colors = {k: v for k, v in workbench(p, mode == 'dark').items() if v}
            name = theme_label(album, mode)
            path = f"themes/{album['slug']}-{mode}.json"
            (ROOT / path).write_text(json.dumps({
                'name': name, 'type': mode, 'semanticHighlighting': True,
                'colors': colors, 'tokenColors': token_colors, 'semanticTokenColors': semantic,
            }, ensure_ascii=False, indent=1) + '\n')
            contributes.append({'label': name, 'uiTheme': 'vs-dark' if mode == 'dark' else 'vs', 'path': f'./{path}'})
        manifest.append({'slug': album['slug'], 'title': album['title'], 'year': album['year'],
                         'mood': album['mood'], 'itunesId': album['itunesId'],
                         'light': theme_label(album, 'light'), 'dark': theme_label(album, 'dark')})
    (ROOT / 'albums.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n')
    (ROOT / 'docs' / 'palettes.svg').write_text(palettes_svg(albums))
    package = {
        'name': 'jay-album-themes', 'displayName': '周杰伦专辑皮肤', 'publisher': 'jakob',
        'description': '16 张周杰伦专辑配色的 VS Code 主题（深浅各一），每日随机，可选右侧渐隐专辑封面。',
        'version': VERSION, 'license': 'MIT', 'repository': {'type': 'git', 'url': REPOSITORY},
        'bugs': {'url': f'{REPOSITORY}/issues'}, 'homepage': f'{REPOSITORY}#readme',
        'keywords': ['theme', 'color-theme', 'jay chou', '周杰伦', 'chinese'],
        'engines': {'vscode': '^1.90.0'}, 'categories': ['Themes'], 'main': './extension.js',
        'activationEvents': ['onStartupFinished'],
        'contributes': {
            'themes': contributes,
            'colors': [
                {'id': 'jayAlbum.title', 'description': '状态栏专辑名',
                 'defaults': {'dark': '#d59432', 'light': '#8a6a1c', 'highContrast': '#ffd27a'}},
                {'id': 'jayAlbum.year', 'description': '状态栏年份',
                 'defaults': {'dark': '#8a8a8a', 'light': '#707070', 'highContrast': '#c0c0c0'}},
            ],
            'commands': [
                {'command': 'jayAlbum.pick', 'title': '选专辑', 'category': '周杰伦皮肤'},
                {'command': 'jayAlbum.next', 'title': '换一张', 'category': '周杰伦皮肤'},
                {'command': 'jayAlbum.daily', 'title': '恢复每日随机', 'category': '周杰伦皮肤'},
            ],
            'configuration': {'title': '周杰伦皮肤', 'properties': {
                'jayAlbum.dailyShuffle': {'type': 'boolean', 'default': True,
                                          'description': '每天自动换一张专辑（洗牌袋，16 天内不重复）。'},
                'jayAlbum.syncBackground': {'type': 'boolean', 'default': False,
                                            'description': '用 background 插件（shalldie.background）在窗口右侧显示渐隐的专辑封面。封面在首次开启时从 Apple iTunes 下载到本机；换专辑时即时跟着换；关掉会还原原来的背景。'},
            }},
        },
    }
    (ROOT / 'package.json').write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
    print(f'albums={len(albums)} themes={len(contributes)}')


if __name__ == '__main__':
    main()
