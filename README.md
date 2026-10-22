# 周杰伦专辑皮肤 · VS Code

把 16 张周杰伦专辑做成 VS Code 配色主题，每张深浅各一套，一共 32 个主题。每天自动换一张，右下角显示今天的专辑名；也可以在窗口右侧显示一张往左渐隐的专辑封面。

![16 张专辑的浅色与深色配色](docs/palettes.png)

收录专辑：Jay · 范特西 · 八度空间 · 叶惠美 · 七里香 · 11月的萧邦 · 依然范特西 · 我很忙 · 魔杰座 · 跨时代 · 惊叹号 · 十二新作 · 哎呦，不错哦 · 周杰伦的床边故事 · 最伟大的作品 · 太阳之子

## 功能

- **32 个主题**：配色是看着每张专辑的封面调出来的，界面、代码高亮、终端都覆盖到。代码文字与背景的对比度不低于 4.5:1（WCAG AA），注释不低于 3.2:1。
- **每日随机**：每天自动换一张，16 张轮完一圈才会重复。第一天固定是《叶惠美》。
- **状态栏角标**：右下角显示「♪ 专辑名 年份」，专辑名用这张专辑的金色。点一下打开专辑列表，可以手动选。
- **渐隐封面（可选）**：窗口右侧显示当前专辑的封面，往左慢慢淡掉。换专辑时封面跟着换，不用重载窗口。

## 安装

1. 到 [Releases](https://github.com/jakob52123/jay-album-vscode/releases) 下载最新的 `.vsix` 文件。
2. 在 VS Code 的扩展面板点右上角「…」，选「从 VSIX 安装…」（Install from VSIX…）；或者在终端运行：

   ```sh
   code --install-extension jay-album-themes-1.0.0.vsix
   ```

装好后会自动切到今天的专辑。也可以在主题列表里（`Cmd/Ctrl+K` 再按 `Cmd/Ctrl+T`）搜「周杰伦」，手动选某一张的深色或浅色版。

## 用法

| 想做什么 | 怎么做 |
|---|---|
| 换专辑 | 点状态栏右下角的专辑名，或在命令面板运行「周杰伦皮肤：选专辑」 |
| 随机换一张 | 「周杰伦皮肤：换一张」 |
| 取消手动选择，回到每天自动换 | 「周杰伦皮肤：恢复每日随机」 |
| 切换深浅 | 在主题列表里选同一张专辑的另一个版本 |
| 关掉每日随机 | 设置里把 `jayAlbum.dailyShuffle` 关掉 |

换成别的主题后，扩展就不会再自动换，角标也会隐藏。

## 渐隐封面

这个功能依赖另一个扩展 [background](https://marketplace.visualstudio.com/items?itemName=shalldie.background)（shalldie.background），默认是关着的。

1. 安装 background 扩展。
2. 在设置里打开 `jayAlbum.syncBackground`。
3. 第一次打开时，扩展会从 Apple iTunes 的公开接口下载 16 张封面到本机，大约 3 MB。
4. background 扩展会提示重载窗口，点确认。只需要这一次，之后换专辑封面会直接跟着换。

需要知道的几件事：

- 这会接管 background 扩展的「全屏」（fullscreen）背景设置。原来的设置会先保存起来，关掉 `jayAlbum.syncBackground` 后自动还原。
- background 扩展要改 VS Code 自己的文件才能显示背景图，所以 VS Code 可能会提示「安装似乎已损坏」。这是 background 扩展本身的行为，它的文档里有说明。
- 换封面不用重载窗口，靠的是借 background 扩展的自定义样式，写入一组「主题 → 封面」的 CSS 规则。这不是 background 扩展官方支持的用法。它以后升级如果改了样式处理方式，封面可能不显示，但配色不受影响。

## 自己构建

主题文件和 `package.json` 都是 `build.py` 从 `data/albums.json` 生成的。要改配色，就改 `data/albums.json`，然后：

```sh
python3 build.py                     # 重新生成 themes/、albums.json、package.json、docs/palettes.svg（README 里用的 palettes.png 由它渲染）
npx @vscode/vsce package             # 打包成 .vsix
```

`data/albums.json` 里每张专辑有 17 个界面颜色（浅深各一套）。代码高亮的颜色由 `build.py` 从中推导，并自动调到够用的对比度。

## 版权说明

- 本项目是粉丝自制作品，与周杰伦本人、杰威尔音乐及各唱片公司没有任何关系，也没有得到他们的认可。专辑名称只用于标明配色的灵感来源。
- 本仓库**不包含**任何专辑封面。封面只在你打开渐隐封面功能时，从 Apple iTunes 下载到你自己的电脑上，版权归原权利人所有。
- 代码和配色数据以 [MIT 许可证](LICENSE) 开源。

---

**English:** VS Code color themes inspired by 16 Jay Chou albums (light + dark each, 32 total), with a daily shuffle, a status-bar album label, and an optional fading album-cover background (requires the `shalldie.background` extension; covers are downloaded from Apple iTunes at runtime and are not distributed with this repository). Fan-made, not affiliated with or endorsed by Jay Chou or JVR Music. MIT licensed.
