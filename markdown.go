package main

import (
	"bytes"
	"fmt"
	"net/url"
	"path"
	"path/filepath"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

// Heading is one entry in the document outline.
type Heading struct {
	Level  int    `json:"level"`
	Text   string `json:"text"`
	ID     string `json:"id"`
	Line   int    `json:"line"`
	Offset int    `json:"offset"`
}

// RenderResult is everything the preview needs for one render pass.
type RenderResult struct {
	HTML     string    `json:"html"`
	Headings []Heading `json:"headings"`
}

func renderMarkdown(content, baseDir string) RenderResult {
	source := []byte(content)
	md := goldmark.New(
		goldmark.WithExtensions(
			extension.GFM,
			extension.Footnote,
			extension.Typographer,
			extension.CJK,
		),
		goldmark.WithParserOptions(
			parser.WithAutoHeadingID(),
		),
	)

	document := md.Parser().Parse(text.NewReader(source))
	headings := collectHeadings(document, source)
	if baseDir != "" {
		rewriteRelativeImages(document, baseDir)
	}

	var output bytes.Buffer
	if err := md.Renderer().Render(&output, source, document); err != nil {
		return RenderResult{
			HTML:     `<p class="render-error">预览渲染失败，请检查文档内容。</p>`,
			Headings: headings,
		}
	}

	return RenderResult{HTML: output.String(), Headings: headings}
}

func collectHeadings(document ast.Node, source []byte) []Heading {
	headings := make([]Heading, 0)
	_ = ast.Walk(document, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		heading, ok := node.(*ast.Heading)
		if !ok {
			return ast.WalkContinue, nil
		}

		offset := 0
		line := 1
		if heading.Lines().Len() > 0 {
			offset = heading.Lines().At(0).Start
			if offset < 0 {
				offset = 0
			}
			if offset > len(source) {
				offset = len(source)
			}
			line = bytes.Count(source[:offset], []byte{'\n'}) + 1
		}

		headings = append(headings, Heading{
			Level:  heading.Level,
			Text:   strings.TrimSpace(string(heading.Text(source))),
			ID:     attributeString(heading, "id"),
			Line:   line,
			Offset: offset,
		})
		return ast.WalkContinue, nil
	})
	return headings
}

func attributeString(node ast.Node, name string) string {
	value, ok := node.AttributeString(name)
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case []byte:
		return string(typed)
	case string:
		return typed
	default:
		return fmt.Sprint(value)
	}
}

func rewriteRelativeImages(document ast.Node, baseDir string) {
	_ = ast.Walk(document, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		image, ok := node.(*ast.Image)
		if !ok {
			return ast.WalkContinue, nil
		}

		destination := string(image.Destination)
		if !isRelativeAsset(destination) {
			return ast.WalkContinue, nil
		}
		decoded, err := url.PathUnescape(destination)
		if err != nil {
			decoded = destination
		}
		cleaned := filepath.ToSlash(filepath.Clean(filepath.FromSlash(decoded)))
		if cleaned == "." {
			return ast.WalkContinue, nil
		}
		image.Destination = []byte("/localfile/?p=" + url.QueryEscape(cleaned))
		return ast.WalkContinue, nil
	})
}

func isRelativeAsset(destination string) bool {
	destination = strings.TrimSpace(destination)
	if destination == "" || strings.HasPrefix(destination, "#") {
		return false
	}
	lower := strings.ToLower(destination)
	for _, prefix := range []string{"http://", "https://", "data:", "file:", "mailto:", "//"} {
		if strings.HasPrefix(lower, prefix) {
			return false
		}
	}
	normalized := strings.ReplaceAll(destination, "\\", "/")
	return !path.IsAbs(normalized) && !filepath.IsAbs(destination)
}

func isMarkdownFile(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".md", ".markdown", ".mdown", ".mkd", ".txt":
		return true
	default:
		return false
	}
}
