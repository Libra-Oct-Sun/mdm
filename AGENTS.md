# Mdmuder

Mdmuder is a Windows desktop Markdown editor inspired by Typora. The product UI is
Chinese; source code and identifiers are English.

## Stack

- Go 1.25+ with Wails v2 (WebView2) for the desktop shell.
- Plain HTML/CSS/JavaScript in `frontend/src`. No frontend framework or package
  manager is needed for the current implementation.
- Goldmark renders CommonMark + GFM, footnotes, task lists, tables and CJK
  typography on the Go side.

## Commands

```powershell
wails dev
wails build -clean
go test ./...
```

Sandboxed runs may need `GOCACHE` pointed at a writable directory inside the
workspace before invoking `go` or `wails`.

## Architecture

- `main.go`: Wails window, embedded assets, drag/drop and asset-server wiring.
- `app.go`: bound desktop API, dialogs, dirty-close guard and local image server.
- `markdown.go`: renderer and outline extraction.
- `htmltable.go`: whitelist sanitizer and renderer for rich HTML tables.
- `files.go`: UTF-8 reading and atomic saving.
- `scripts/generate_icon.py`: regenerates `build/appicon.png` and the Windows
  multi-size `.ico` from the app's jade/cinnabar visual language.
- `frontend/src/index.html`: application shell and toolbar.
- `frontend/src/main.js`: WYSIWYG editor state, HTML-to-Markdown serialization,
  commands, outline, history, find and shortcuts.
- `frontend/src/main.css`: themes and typography.

## Guardrails

- Keep filesystem access in Go. The frontend calls bound methods instead of using
  browser file APIs.
- Preview HTML must remain safe: do not enable Goldmark's unsafe HTML mode.
- Complex tables may use the whitelisted HTML table subset rendered by
  `htmltable.go`; keep scripts, event attributes and unsanitized styles out.
- Relative images are served only from the current document's directory. Keep the
  path traversal checks in `App.ServeHTTP`.
- Save documents as UTF-8 with normalized LF newlines. Never truncate a file
  before a successful atomic replace.
- Preserve unsaved-change prompts when changing files or closing the window.
- Keep the interface keyboard-usable and retain the light/dark themes.
- The first release targets Windows only. Do not add macOS/Linux-specific UI.
- Startup accepts one Markdown path on the command line via `TakeStartupFile`.
- WebView2/Chromium may fail to create controllers in a restricted sandbox even
  when the build succeeds. Treat that as an environment limitation, not a code
  failure; verify UI behavior on a normal interactive Windows desktop.

## Product scope

The core loop is: open/edit a formatted document -> serialize to Markdown ->
save. The editor is a single-pane WYSIWYG surface backed by an HTML-to-Markdown
serializer; keep it that way rather than reintroducing a split preview or source
pane. Secondary features include outline navigation, formatting shortcuts,
find, drag-and-drop and relative images. Any new feature should keep editing
responsive and avoid surprising data changes.
