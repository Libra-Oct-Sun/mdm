# Changelog

All notable user-facing changes are documented here. Versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Document tabs can now be reordered by dragging, with `Alt+Left/Right`
  keyboard reordering when a tab is focused.
- The editor chrome was redesigned around a compact, tool-like layout: a
  shorter title bar, quieter tabs, tighter toolbar, narrower outline and a
  focused 790px writing column.

## [0.3.0] - 2026-10-20

### Added

- Multiple documents now open in tabs, with per-tab buffers, unsaved state and
  undo history. Opening or dragging another Markdown file no longer replaces
  the document that is already being edited.
- Tables now expose a contextual toolbar for inserting and deleting rows and
  columns, and `Tab` / `Shift+Tab` move between cells (adding a row after the
  final cell).
- Images can now be selected in the editor to edit their alt text and display
  width/height. Dimensions are preserved in the Markdown image title as
  `"=WxH"`.
- Rich table editing now supports merged cells, cell splitting, multi-paragraph
  cells, span-aware row/column operations and keyboard navigation. Simple
  tables remain GFM pipe tables; complex tables round-trip as safe HTML tables.
- Pasted HTML tables preserve `rowspan`, `colspan`, alignment and paragraph
  structure. The Go renderer accepts only a whitelisted HTML table subset and
  keeps raw script/style/event attributes out of the preview.

### Fixed

- Switching document tabs now restores each tab's own scroll position instead
  of copying the previous tab's position.
- Recovery drafts are stored per tab, so saving, closing or creating another
  document no longer removes another tab's unsaved snapshot.
- Reopening the active file no longer clears the unsaved close guard, and
  Save As refuses a destination that is already open in another tab.
- Tab switching, saving and image pasting are serialized so asynchronous
  operations cannot write one document's buffer into another.
- Closing a dirty background tab now returns to the previously active tab.

## [0.1.0] - 2026-10-19

### Added

- Windows Markdown editor with a single-pane WYSIWYG editing surface.
- GFM tables, task lists, footnotes, CJK typography and outline navigation.
- File open, save, save as, drag-and-drop and command-line document opening.
- Unsaved-change protection, search, keyboard shortcuts and light/dark themes.
- Automated Go and frontend tests, Windows build verification and release
  archives for tagged versions.

## [0.2.0] - 2026-10-19

### Added

- Automatic recovery drafts for unsaved edits, with restore or discard on the
  next launch.
- Pasted clipboard images are saved under `assets/` beside the document and
  inserted with relative paths.
- Find and replace, including replace-current and replace-all.
- Windows installer with optional `.md`, `.markdown` and `.mdown` associations.
