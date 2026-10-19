# Mdmuder

一个面向 Windows 的 Markdown 桌面编辑器，使用 Go + Wails（WebView2）构建。
界面参考 Typora 的单栏专注写作体验：正文直接以标题、粗体、列表、表格等格式编辑，
Markdown 标记只在后台生成和保存，不占用编辑视图。

## 功能

- 单栏所见即所得编辑，不显示 Markdown 源码标记
- GFM 表格、任务列表、删除线、自动链接，以及脚注和中文排版优化
- 标题大纲导航，点击即可跳转到正文对应位置
- 文件打开、保存、另存为、拖放打开
- 支持通过命令行直接打开文件（`Mdmuder.exe 文章.md`）
- 未保存更改保护，关闭窗口或切换文件前会提示
- 粗体、斜体、标题、引用、列表、链接、图片、代码块等快捷工具栏
- 输入 `# `、`- `、`1. `、`> ` 或 ` ``` ` 自动转换 Markdown 块格式
- 输入 `**文字**`、`*文字*`、`~~文字~~`、`` `文字` `` 自动转换为富文本
- 撤销 / 重做、查找、列表自动续写、Tab 缩进
- 浅色 / 深色主题
- 文档内相对路径图片显示

## 开发

环境要求：

- Go 1.25+
- Wails CLI v2.16+
- Windows 10/11 与 WebView2 Runtime

```powershell
wails dev
```

运行测试：

```powershell
go test ./...
```

构建 Windows 可执行文件：

```powershell
wails build -clean
```

产物位于 `build/bin/Mdmuder.exe`。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+N` | 新建文档 |
| `Ctrl+O` | 打开文件 |
| `Ctrl+S` | 保存 |
| `Ctrl+Shift+S` | 另存为 |
| `Ctrl+B` | 粗体 |
| `Ctrl+I` | 斜体 |
| `Ctrl+K` | 插入链接 |
| `Ctrl+F` | 查找 |
| `Ctrl+Z` / `Ctrl+Y` | 撤销 / 重做 |
| `Ctrl+\` | 显示或隐藏大纲 |

## 说明

- 当前版本采用单栏所见即所得编辑，正文中的 Markdown 标记会被转换为实际格式。
- 文档以 UTF-8 读取，保存时统一使用 LF 换行。
- 渲染后的正文不会执行 Markdown 中的原始 HTML/脚本，以降低打开不可信文档的风险。
- 相对路径图片限制在当前文档所在目录内。
- 如果启动时出现 WebView2 控制器错误，请安装或更新 Microsoft Edge WebView2 Runtime。
