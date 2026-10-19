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
