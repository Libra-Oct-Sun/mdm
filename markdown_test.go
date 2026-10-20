package main

import (
	"strings"
	"testing"
)

func TestRenderMarkdownBuildsOutlineAndGFM(t *testing.T) {
	source := "# 标题\n\n## 子标题\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] 完成\n"
	result := renderMarkdown(source, "")

	if len(result.Headings) != 2 {
		t.Fatalf("expected 2 headings, got %d", len(result.Headings))
	}
	if result.Headings[0].Text != "标题" || result.Headings[1].Text != "子标题" {
		t.Fatalf("unexpected heading text: %#v", result.Headings)
	}
	if result.Headings[0].ID == "" || result.Headings[0].Line != 1 {
		t.Fatalf("heading should have id and line: %#v", result.Headings[0])
	}
	if !strings.Contains(result.HTML, "<table>") {
		t.Fatalf("GFM table was not rendered: %s", result.HTML)
	}
	if !strings.Contains(result.HTML, `type="checkbox"`) {
		t.Fatalf("task list was not rendered: %s", result.HTML)
	}
}

func TestRenderMarkdownDoesNotEmitUnsafeHTML(t *testing.T) {
	result := renderMarkdown("Hello\n\n<script>alert(1)</script>\n", "")
	if strings.Contains(result.HTML, "<script>") {
		t.Fatalf("raw script leaked into preview: %s", result.HTML)
	}
}

func TestRenderMarkdownRewritesRelativeImages(t *testing.T) {
	result := renderMarkdown("![图](images/a%20b.png)\n", `C:\notes`)
	if !strings.Contains(result.HTML, "/localfile/?p=images%2Fa+b.png") {
		t.Fatalf("relative image was not rewritten: %s", result.HTML)
	}
}

func TestRenderMarkdownLeavesRemoteImagesAlone(t *testing.T) {
	result := renderMarkdown("![图](https://example.com/a.png)\n", `C:\notes`)
	if !strings.Contains(result.HTML, "https://example.com/a.png") {
		t.Fatalf("remote image should be untouched: %s", result.HTML)
	}
}

func TestRenderMarkdownRendersSafeHTMLTables(t *testing.T) {
	source := `<table>
<thead><tr><th colspan="2">合并表头</th></tr></thead>
<tbody><tr><td rowspan="2"><p>第一段</p><p>第二段</p></td><td>B</td></tr>
<tr><td>C</td></tr></tbody>
</table>
`
	result := renderMarkdown(source, "")

	for _, expected := range []string{
		`<table>`,
		`<th colspan="2">合并表头</th>`,
		`<td rowspan="2"><p>第一段</p><p>第二段</p></td>`,
		`<td>C</td>`,
	} {
		if !strings.Contains(result.HTML, expected) {
			t.Fatalf("expected %q in sanitized table: %s", expected, result.HTML)
		}
	}
}

func TestRenderMarkdownSanitizesHTMLTableAttributes(t *testing.T) {
	source := `<table onclick="alert(1)">
<tr><td colspan="2" style="color:red" onmouseover="alert(1)">
<script>alert(1)</script><a href="javascript:alert(1)">ok</a>
</td></tr>
</table>
`
	result := renderMarkdown(source, "")

	for _, blocked := range []string{"onclick", "onmouseover", "javascript:", "<script", `style=`} {
		if strings.Contains(result.HTML, blocked) {
			t.Fatalf("unsafe table content %q leaked: %s", blocked, result.HTML)
		}
	}
	if !strings.Contains(result.HTML, `<td colspan="2">`) {
		t.Fatalf("safe cell attributes were lost: %s", result.HTML)
	}
	if !strings.Contains(result.HTML, "ok") {
		t.Fatalf("safe text content was lost: %s", result.HTML)
	}
}

func TestRenderMarkdownRewritesImagesInsideHTMLTables(t *testing.T) {
	source := `<table><tr><td><p><img src="images/a%20b.png" alt="图"></p></td></tr></table>
`
	result := renderMarkdown(source, `C:\notes`)

	if !strings.Contains(result.HTML, "/localfile/?p=images%2Fa+b.png") {
		t.Fatalf("relative image inside HTML table was not rewritten: %s", result.HTML)
	}
}

func TestRenderMarkdownStillOmitsNonTableHTML(t *testing.T) {
	result := renderMarkdown("<div>not a table</div>\n", "")
	if strings.Contains(result.HTML, "not a table") {
		t.Fatalf("non-table raw HTML should remain omitted: %s", result.HTML)
	}
}
