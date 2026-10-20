package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadDocumentFileNormalizesAndStripsBOM(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "笔记.md")
	if err := os.WriteFile(path, []byte("\xEF\xBB\xBF# 标题\r\n\r\n正文"), 0o644); err != nil {
		t.Fatal(err)
	}

	doc, err := readDocumentFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Content != "# 标题\n\n正文" {
		t.Fatalf("unexpected content: %q", doc.Content)
	}
	if doc.Name != "笔记.md" {
		t.Fatalf("unexpected name: %q", doc.Name)
	}
}

func TestReadDocumentFileRejectsBinary(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "binary.md")
	if err := os.WriteFile(path, []byte{'a', 0, 'b'}, 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := readDocumentFile(path)
	if err == nil || !strings.Contains(err.Error(), "二进制") {
		t.Fatalf("expected binary error, got %v", err)
	}
}

func TestWriteFileAtomicReplacesExistingFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "note.md")
	if err := os.WriteFile(path, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writeFileAtomic(path, []byte("new")); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "new" {
		t.Fatalf("unexpected content: %q", data)
	}
}

func TestLocalFileHandlerServesImagesInsideDocumentDirectory(t *testing.T) {
	dir := t.TempDir()
	docPath := filepath.Join(dir, "note.md")
	imagePath := filepath.Join(dir, "images", "a b.png")
	if err := os.MkdirAll(filepath.Dir(imagePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(docPath, []byte("# note"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(imagePath, []byte("image-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}

	app := NewApp()
	app.docPath = docPath
	handler := &localFileHandler{app: app}
	request := httptest.NewRequest(http.MethodGet, "/localfile/?p=images%2Fa+b.png", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Body.String() != "image-bytes" {
		t.Fatalf("unexpected body: %q", recorder.Body.String())
	}
}

func TestLocalFileHandlerRejectsPathTraversal(t *testing.T) {
	parent := t.TempDir()
	docDir := filepath.Join(parent, "docs")
	if err := os.MkdirAll(docDir, 0o755); err != nil {
		t.Fatal(err)
	}
	docPath := filepath.Join(docDir, "note.md")
	if err := os.WriteFile(docPath, []byte("# note"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(parent, "secret.txt"), []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}

	app := NewApp()
	app.docPath = docPath
	handler := &localFileHandler{app: app}
	request := httptest.NewRequest(http.MethodGet, "/localfile/?p=..%2Fsecret.txt", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", recorder.Code)
	}
}

func TestLocalFileHandlerRequiresSavedDocument(t *testing.T) {
	app := NewApp()
	handler := &localFileHandler{app: app}
	request := httptest.NewRequest(http.MethodGet, "/localfile/?p=image.png", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", recorder.Code)
	}
}

func TestResolveDocumentLink(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "other.md")
	if err := os.WriteFile(target, []byte("# other"), 0o644); err != nil {
		t.Fatal(err)
	}

	app := NewApp()
	app.docPath = filepath.Join(dir, "note.md")
	resolved, err := app.ResolveDocumentLink("other.md#section", "")
	if err != nil {
		t.Fatal(err)
	}
	if resolved != target {
		t.Fatalf("expected %q, got %q", target, resolved)
	}

	if _, err := app.ResolveDocumentLink("https://example.com/other.md", ""); err == nil {
		t.Fatal("expected remote link to be rejected")
	}
	if _, err := app.ResolveDocumentLink("image.png", ""); err == nil {
		t.Fatal("expected non-Markdown link to be rejected")
	}
}
