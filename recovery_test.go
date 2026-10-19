package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRecoveryDraftRoundTrip(t *testing.T) {
	dir := t.TempDir()
	draft := RecoveryDraft{
		Path:        filepath.Join(dir, "note.md"),
		Name:        "note.md",
		Content:     "# 恢复后的内容",
		BaseContent: "# 上次保存的内容",
	}

	if err := saveRecoveryDraft(dir, &draft); err != nil {
		t.Fatal(err)
	}
	loaded, err := loadRecoveryDraft(dir)
	if err != nil {
		t.Fatal(err)
	}
	if loaded == nil {
		t.Fatal("expected a recovery draft")
	}
	if loaded.Path != draft.Path || loaded.Name != draft.Name {
		t.Fatalf("unexpected identity: %#v", loaded)
	}
	if loaded.Content != draft.Content || loaded.BaseContent != draft.BaseContent {
		t.Fatalf("unexpected content: %#v", loaded)
	}
	if loaded.SavedAt.IsZero() || time.Since(loaded.SavedAt) > time.Minute {
		t.Fatalf("unexpected saved time: %v", loaded.SavedAt)
	}
}

func TestLoadRecoveryDraftReturnsNilWhenMissing(t *testing.T) {
	draft, err := loadRecoveryDraft(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if draft != nil {
		t.Fatalf("expected no draft, got %#v", draft)
	}
}

func TestClearRecoveryDraftRemovesSnapshot(t *testing.T) {
	dir := t.TempDir()
	draft := RecoveryDraft{Name: "未命名.md", Content: "draft"}
	if err := saveRecoveryDraft(dir, &draft); err != nil {
		t.Fatal(err)
	}

	if err := clearRecoveryDraft(dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(recoveryDraftPath(dir)); !os.IsNotExist(err) {
		t.Fatalf("expected recovery snapshot to be removed, got %v", err)
	}
}

func TestRecoveryDraftPreservesEmptyContent(t *testing.T) {
	dir := t.TempDir()
	draft := RecoveryDraft{Name: "空文档.md", Content: "", BaseContent: "旧内容"}
	if err := saveRecoveryDraft(dir, &draft); err != nil {
		t.Fatal(err)
	}

	loaded, err := loadRecoveryDraft(dir)
	if err != nil {
		t.Fatal(err)
	}
	if loaded == nil || loaded.Content != "" || loaded.BaseContent != "旧内容" {
		t.Fatalf("unexpected empty draft: %#v", loaded)
	}
}
