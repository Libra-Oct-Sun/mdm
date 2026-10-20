package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRecoveryDraftRoundTrip(t *testing.T) {
	dir := t.TempDir()
	draft := RecoveryDraft{
		ID:          "document-1",
		Path:        filepath.Join(dir, "note.md"),
		Name:        "note.md",
		Content:     "# 恢复后的内容",
		BaseContent: "# 上次保存的内容",
	}

	if err := saveRecoveryDraft(dir, &draft); err != nil {
		t.Fatal(err)
	}
	loaded, err := loadRecoveryDrafts(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded) != 1 {
		t.Fatalf("expected one recovery draft, got %#v", loaded)
	}
	if loaded[0].ID != draft.ID || loaded[0].Path != draft.Path || loaded[0].Name != draft.Name {
		t.Fatalf("unexpected identity: %#v", loaded[0])
	}
	if loaded[0].Content != draft.Content || loaded[0].BaseContent != draft.BaseContent {
		t.Fatalf("unexpected content: %#v", loaded[0])
	}
	if loaded[0].SavedAt.IsZero() || time.Since(loaded[0].SavedAt) > time.Minute {
		t.Fatalf("unexpected saved time: %v", loaded[0].SavedAt)
	}
}

func TestLoadRecoveryDraftsReturnsEmptyWhenMissing(t *testing.T) {
	drafts, err := loadRecoveryDrafts(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(drafts) != 0 {
		t.Fatalf("expected no drafts, got %#v", drafts)
	}
}

func TestRecoveryDraftsAreIndependent(t *testing.T) {
	dir := t.TempDir()
	first := RecoveryDraft{ID: "document-1", Name: "first.md", Content: "first draft"}
	second := RecoveryDraft{ID: "document-2", Name: "second.md", Content: "second draft"}
	if err := saveRecoveryDraft(dir, &first); err != nil {
		t.Fatal(err)
	}
	if err := saveRecoveryDraft(dir, &second); err != nil {
		t.Fatal(err)
	}

	drafts, err := loadRecoveryDrafts(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(drafts) != 2 {
		t.Fatalf("expected two drafts, got %#v", drafts)
	}

	if err := clearRecoveryDraft(dir, first.ID); err != nil {
		t.Fatal(err)
	}
	drafts, err = loadRecoveryDrafts(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(drafts) != 1 || drafts[0].ID != second.ID || drafts[0].Content != second.Content {
		t.Fatalf("unexpected drafts after clearing one: %#v", drafts)
	}
}

func TestClearRecoveryDraftsRemovesEverySnapshot(t *testing.T) {
	dir := t.TempDir()
	for _, draft := range []RecoveryDraft{
		{ID: "document-1", Name: "one.md", Content: "one"},
		{ID: "document-2", Name: "two.md", Content: "two"},
	} {
		if err := saveRecoveryDraft(dir, &draft); err != nil {
			t.Fatal(err)
		}
	}
	if err := clearRecoveryDrafts(dir); err != nil {
		t.Fatal(err)
	}
	drafts, err := loadRecoveryDrafts(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(drafts) != 0 {
		t.Fatalf("expected all drafts to be removed, got %#v", drafts)
	}
}

func TestRecoveryDraftPreservesEmptyContent(t *testing.T) {
	dir := t.TempDir()
	draft := RecoveryDraft{ID: "document-1", Name: "空文档.md", Content: "", BaseContent: "旧内容"}
	if err := saveRecoveryDraft(dir, &draft); err != nil {
		t.Fatal(err)
	}

	loaded, err := loadRecoveryDrafts(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded) != 1 || loaded[0].Content != "" || loaded[0].BaseContent != "旧内容" {
		t.Fatalf("unexpected empty draft: %#v", loaded)
	}
}

func TestLegacyRecoveryDraftIsLoaded(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	legacy := RecoveryDraft{
		Name:        "legacy.md",
		Content:     "legacy draft",
		BaseContent: "old content",
		SavedAt:     time.Now().UTC(),
	}
	data, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(recoveryDraftPath(dir, legacyRecoveryID), data, 0o600); err != nil {
		t.Fatal(err)
	}

	drafts, err := loadRecoveryDrafts(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(drafts) != 1 || drafts[0].ID != legacyRecoveryID || drafts[0].Content != "legacy draft" {
		t.Fatalf("unexpected legacy draft: %#v", drafts)
	}
}
