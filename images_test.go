package main

import (
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const onePixelPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl5r5cAAAAASUVORK5CYII="

func TestSavePastedImageWritesRelativeAsset(t *testing.T) {
	dir := t.TempDir()
	docPath := filepath.Join(dir, "note.md")
	if err := os.WriteFile(docPath, []byte("# note"), 0o644); err != nil {
		t.Fatal(err)
	}

	saved, err := savePastedImage(docPath, "data:image/png;base64,"+onePixelPNG)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(saved.RelativePath, "assets/") {
		t.Fatalf("unexpected relative path: %q", saved.RelativePath)
	}
	if filepath.Ext(saved.RelativePath) != ".png" {
		t.Fatalf("unexpected extension: %q", saved.RelativePath)
	}
	data, err := os.ReadFile(saved.Path)
	if err != nil {
		t.Fatal(err)
	}
	if http.DetectContentType(data) != "image/png" {
		t.Fatalf("unexpected saved content type: %q", http.DetectContentType(data))
	}
}

func TestSavePastedImageRequiresSavedDocument(t *testing.T) {
	_, err := savePastedImage("", "data:image/png;base64,"+onePixelPNG)
	if err == nil || !strings.Contains(err.Error(), "先保存") {
		t.Fatalf("expected saved-document error, got %v", err)
	}
}

func TestSavePastedImageRejectsInvalidData(t *testing.T) {
	dir := t.TempDir()
	docPath := filepath.Join(dir, "note.md")
	if err := os.WriteFile(docPath, []byte("# note"), 0o644); err != nil {
		t.Fatal(err)
	}

	cases := []string{
		"not-a-data-url",
		"data:text/plain;base64," + base64.StdEncoding.EncodeToString([]byte("hello")),
		"data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte("<svg/>")),
		"data:image/png;base64,not-base64",
	}
	for _, input := range cases {
		if _, err := savePastedImage(docPath, input); err == nil {
			t.Fatalf("expected %q to be rejected", input)
		}
	}
}
