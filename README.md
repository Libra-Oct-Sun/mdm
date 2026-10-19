# Mdmuder

[![CI](https://github.com/Libra-Oct-Sun/mdm/actions/workflows/ci.yml/badge.svg)](https://github.com/Libra-Oct-Sun/mdm/actions/workflows/ci.yml)

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
- 查找替换、未保存草稿自动恢复
- 直接粘贴剪贴板截图，自动保存到文档旁并插入相对路径
- Windows 安装包与 `.md` / `.markdown` / `.mdown` 文件关联
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
.\scripts\test.ps1
```

该脚本会检查 Go 格式、运行 `go vet` 和 Go 单元测试、检查前端语法、
运行前端序列化、查找替换、恢复草稿和图片粘贴测试，最后执行一次 Windows 构建。
如果只想运行快速检查，可以使用 `.\scripts\test.ps1 -SkipBuild`。
需要同时验证安装包时，使用 `.\scripts\test.ps1 -Installer`。

构建 Windows 可执行文件：

```powershell
wails build -clean
```

产物位于 `build/bin/Mdmuder.exe`。

构建带文件关联的用户级安装包（需要 NSIS）：

```powershell
wails build -clean -nsis -installscope user
```

安装包会注册 `.md`、`.markdown` 和 `.mdown` 文件关联。

## 发布

推送到 `main` 的提交和 Pull Request 会自动运行 CI。发布时推送语义化版本标签：

```powershell
git tag -a v0.1.0 -m "Release 0.1.0"
git push origin v0.1.0
```

标签会触发 Release 工作流：先执行全部测试和 Windows 构建，再创建 GitHub
Release，并附加可执行文件、ZIP 包和 SHA-256 校验文件。

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
| `Ctrl+H` | 查找并替换 |
| `Ctrl+Z` / `Ctrl+Y` | 撤销 / 重做 |
| `Ctrl+\` | 显示或隐藏大纲 |

## 说明

- 当前版本采用单栏所见即所得编辑，正文中的 Markdown 标记会被转换为实际格式。
- 文档以 UTF-8 读取，保存时统一使用 LF 换行。
- 渲染后的正文不会执行 Markdown 中的原始 HTML/脚本，以降低打开不可信文档的风险。
- 相对路径图片限制在当前文档所在目录内。
- 如果启动时出现 WebView2 控制器错误，请安装或更新 Microsoft Edge WebView2 Runtime。
