package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOpenPathLeavesDirtyGuardStateUntouched(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "note.md")
	if err := os.WriteFile(path, []byte("# note"), 0o644); err != nil {
		t.Fatal(err)
	}

	app := &App{dirty: true, closePrompt: true}
	if _, err := app.OpenPath(path); err != nil {
		t.Fatal(err)
	}
	if !app.dirty || !app.closePrompt {
		t.Fatalf("OpenPath must not clear the close guard: dirty=%v closePrompt=%v", app.dirty, app.closePrompt)
	}
}

func TestSetActiveDocumentKeepsPendingClosePrompt(t *testing.T) {
	app := &App{closePrompt: true}
	app.SetActiveDocument("")
	if !app.closePrompt {
		t.Fatal("changing the active document must not dismiss a pending close prompt")
	}
}

func TestPathAlreadyOpen(t *testing.T) {
	dir := t.TempDir()
	openPath := filepath.Join(dir, "Note.md")
	if !pathAlreadyOpen(filepath.Join(dir, "note.md"), []string{openPath}) {
		t.Fatal("expected the same path with different casing to match")
	}
	if pathAlreadyOpen(filepath.Join(dir, "other.md"), []string{openPath}) {
		t.Fatal("did not expect a different path to match")
	}
	if pathAlreadyOpen(openPath, nil) {
		t.Fatal("nil open paths should never match")
	}
}

func TestSaveToPathLeavesDirtyGuardToFrontend(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "note.md")
	app := &App{dirty: true}
	if _, err := app.saveToPath(path, "# saved"); err != nil {
		t.Fatal(err)
	}
	if !app.dirty {
		t.Fatal("saveToPath must let the frontend decide whether other tabs are still dirty")
	}
}
