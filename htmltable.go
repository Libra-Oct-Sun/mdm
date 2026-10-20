package main

import (
	"net/url"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/util"
	xhtml "golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

type safeHTMLTableRenderer struct{}

func (r *safeHTMLTableRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(ast.KindHTMLBlock, r.renderHTMLBlock)
}

func (r *safeHTMLTableRenderer) renderHTMLBlock(
	w util.BufWriter, source []byte, node ast.Node, entering bool,
) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	block := node.(*ast.HTMLBlock)
	var raw strings.Builder
	lines := block.Lines()
	for index := 0; index < lines.Len(); index++ {
		line := lines.At(index)
		raw.Write(line.Value(source))
	}
	if block.HasClosure() {
		raw.Write(block.ClosureLine.Value(source))
	}
	if table := sanitizeHTMLTables(raw.String()); table != "" {
		_, _ = w.WriteString(table)
		_, _ = w.WriteString("\n")
	}
	return ast.WalkSkipChildren, nil
}

var safeTableTags = map[string]bool{
	"table": true, "caption": true, "colgroup": true, "col": true,
	"thead": true, "tbody": true, "tfoot": true, "tr": true, "th": true, "td": true,
	"p": true, "div": true, "br": true, "hr": true,
	"strong": true, "b": true, "em": true, "i": true, "del": true, "s": true,
	"strike": true, "code": true, "pre": true, "blockquote": true,
	"ul": true, "ol": true, "li": true, "a": true, "img": true,
	"span": true, "u": true, "mark": true, "sup": true, "sub": true, "input": true,
}

var blockedTableTags = map[string]bool{
	"script": true, "style": true, "iframe": true, "object": true, "embed": true,
	"form": true, "meta": true, "link": true, "template": true, "svg": true,
	"math": true, "video": true, "audio": true,
}

var voidTableTags = map[string]bool{
	"br": true, "hr": true, "img": true, "col": true, "input": true,
}

func sanitizeHTMLTables(raw string) string {
	context := &xhtml.Node{Type: xhtml.ElementNode, Data: "div", DataAtom: atom.Div}
	nodes, err := xhtml.ParseFragment(strings.NewReader(raw), context)
	if err != nil {
		return ""
	}
	var output strings.Builder
	for _, node := range nodes {
		if node.Type == xhtml.ElementNode && strings.EqualFold(node.Data, "table") {
			renderSafeTableNode(&output, node)
		}
	}
	return output.String()
}

func renderSafeTableNode(output *strings.Builder, node *xhtml.Node) {
	if node.Type == xhtml.TextNode {
		output.WriteString(xhtml.EscapeString(node.Data))
		return
	}
	if node.Type != xhtml.ElementNode {
		return
	}
	tag := strings.ToLower(node.Data)
	if blockedTableTags[tag] {
		return
	}
	if !safeTableTags[tag] {
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			renderSafeTableNode(output, child)
		}
		return
	}

	attributes := safeTableAttributes(tag, node.Attr)
	output.WriteString("<")
	output.WriteString(tag)
	for _, attribute := range attributes {
		output.WriteString(" ")
		output.WriteString(attribute.Key)
		output.WriteString(`="`)
		output.WriteString(xhtml.EscapeString(attribute.Val))
		output.WriteString(`"`)
	}
	output.WriteString(">")
	if voidTableTags[tag] {
		return
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		renderSafeTableNode(output, child)
	}
	output.WriteString("</")
	output.WriteString(tag)
	output.WriteString(">")
}

func safeTableAttributes(tag string, attributes []xhtml.Attribute) []xhtml.Attribute {
	result := make([]xhtml.Attribute, 0, len(attributes))
	for _, attribute := range attributes {
		name := strings.ToLower(attribute.Key)
		value := strings.TrimSpace(attribute.Val)
		switch tag {
		case "th", "td":
			switch name {
			case "colspan", "rowspan":
				if span, ok := positiveSpan(value); ok && span > 1 {
					result = append(result, xhtml.Attribute{Key: name, Val: strconv.Itoa(span)})
				}
			case "align":
				if align := safeAlignment(value); align != "" {
					result = append(result, xhtml.Attribute{Key: "align", Val: align})
				}
			}
		case "a":
			switch name {
			case "href":
				if href, ok := safeLinkHref(value); ok {
					result = append(result, xhtml.Attribute{Key: "href", Val: href})
				}
			case "title":
				result = append(result, xhtml.Attribute{Key: "title", Val: value})
			}
		case "img":
			switch name {
			case "src":
				if source, ok := safeImageSource(value); ok {
					result = append(result, xhtml.Attribute{Key: "src", Val: source})
				}
			case "alt", "title":
				result = append(result, xhtml.Attribute{Key: name, Val: value})
			}
		case "code":
			if name == "class" && isLanguageClass(value) {
				result = append(result, xhtml.Attribute{Key: "class", Val: value})
			}
		case "ol":
			if name == "start" {
				if start, err := strconv.Atoi(value); err == nil && start > 0 && start != 1 {
					result = append(result, xhtml.Attribute{Key: "start", Val: strconv.Itoa(start)})
				}
			}
		case "col":
			switch name {
			case "span":
				if span, ok := positiveSpan(value); ok && span > 1 {
					result = append(result, xhtml.Attribute{Key: "span", Val: strconv.Itoa(span)})
				}
			case "width":
				if safeColumnWidth(value) {
					result = append(result, xhtml.Attribute{Key: "width", Val: value})
				}
			}
		case "input":
			switch name {
			case "type":
				if strings.EqualFold(value, "checkbox") {
					result = append(result, xhtml.Attribute{Key: "type", Val: "checkbox"})
				}
			case "checked":
				result = append(result, xhtml.Attribute{Key: "checked", Val: ""})
			}
		}
	}
	return result
}

func positiveSpan(value string) (int, bool) {
	span, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || span < 1 {
		return 0, false
	}
	if span > 1000 {
		span = 1000
	}
	return span, true
}

func safeAlignment(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "left", "center", "right":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func safeColumnWidth(value string) bool {
	if value == "" {
		return false
	}
	if strings.HasSuffix(value, "%") {
		value = strings.TrimSuffix(value, "%")
	}
	width, err := strconv.Atoi(value)
	return err == nil && width > 0 && width <= 10000
}

func isLanguageClass(value string) bool {
	if !strings.HasPrefix(value, "language-") {
		return false
	}
	for _, char := range value[len("language-"):] {
		if !(char == '-' || char == '_' ||
			(char >= 'a' && char <= 'z') ||
			(char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9')) {
			return false
		}
	}
	return true
}

func safeLinkHref(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false
	}
	lower := strings.ToLower(value)
	for _, blocked := range []string{"javascript:", "vbscript:", "data:", "file:"} {
		if strings.HasPrefix(lower, blocked) {
			return "", false
		}
	}
	if strings.HasPrefix(value, "#") ||
		strings.HasPrefix(value, "/") ||
		strings.HasPrefix(value, "./") ||
		strings.HasPrefix(value, "../") ||
		strings.HasPrefix(lower, "http://") ||
		strings.HasPrefix(lower, "https://") ||
		strings.HasPrefix(lower, "mailto:") {
		return value, true
	}
	if strings.Contains(value, ":") {
		return "", false
	}
	return value, true
}

func safeImageSource(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false
	}
	lower := strings.ToLower(value)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") ||
		strings.HasPrefix(lower, "data:image/") {
		return value, true
	}
	if strings.HasPrefix(lower, "javascript:") || strings.HasPrefix(lower, "file:") ||
		strings.HasPrefix(value, "//") {
		return "", false
	}
	if !isRelativeAsset(value) {
		return "", false
	}
	decoded, err := url.PathUnescape(value)
	if err != nil {
		decoded = value
	}
	cleaned := filepath.ToSlash(filepath.Clean(filepath.FromSlash(decoded)))
	if cleaned == "." || cleaned == ".." ||
		strings.HasPrefix(cleaned, "../") ||
		path.IsAbs(cleaned) {
		return "", false
	}
	return "/localfile/?p=" + url.QueryEscape(cleaned), true
}
