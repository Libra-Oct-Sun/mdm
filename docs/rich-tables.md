# Rich Tables

Mdmuder keeps simple tables portable and only falls back to HTML when Markdown
pipe tables cannot represent the document.

## Format Selection

- A rectangular table whose cells contain inline content is saved as a GFM pipe
  table.
- A table with `rowspan`, `colspan`, a caption, a `colgroup`, or block content
  such as paragraphs, lists, code blocks or nested tables is saved as one HTML
  table block.
- HTML tables must not contain blank lines. A blank line ends a CommonMark HTML
  block and would split the table into unrelated Markdown blocks.

## Editing

- Select more than one cell and choose **合并** in the contextual toolbar to
  merge the selected rectangle. Existing spans that intersect the selection are
  included in the merged area.
- Choose **拆分** to turn the current merged cell back into independent cells.
  The original content stays in the top-left cell.
- `Tab` / `Shift+Tab` move between visible cells, skipping cells covered by a
  span. Pressing `Tab` in the final cell appends a row.
- `Enter` inside a cell creates a new paragraph. `Shift+Enter` inserts a line
  break.
- Row and column insertion expands merged cells crossed by the new row/column;
  deletion shrinks or removes the affected span.

## Supported HTML

The renderer accepts a safe subset of table HTML:

- Structure: `table`, `caption`, `colgroup`, `col`, `thead`, `tbody`, `tfoot`,
  `tr`, `th`, `td`.
- Cell attributes: `colspan`, `rowspan`, `align` (`left`, `center`, `right`).
- Block content: `p`, `div`, `ul`, `ol`, `li`, `blockquote`, `pre`, `hr`.
- Inline content: `strong`, `b`, `em`, `i`, `del`, `s`, `strike`, `code`,
  `a`, `img`, `span`, `u`, `mark`, `sup`, `sub`, `br`, and checkbox `input`.
- `col` may carry `span` and numeric/percentage `width`.
- Images and links are URL-checked. Relative image paths are rewritten through
  the document's local image server; paths escaping the document directory are
  rejected.

Everything else is removed or unwrapped. In particular, scripts, styles,
iframes, embedded objects, event handlers and arbitrary `style` attributes are
never emitted.

## Portability

GFM renderers do not understand merged cells or block content inside cells. A
complex table therefore relies on HTML table support in the target Markdown
application. Typora and many modern Markdown viewers support this; strict GFM
renderers may flatten or omit the table.
