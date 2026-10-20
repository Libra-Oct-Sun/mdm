package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	recoveryFilename = "draft.json"
	legacyRecoveryID = "legacy"
)

// RecoveryDraft is one unsaved editor buffer kept outside its document.
type RecoveryDraft struct {
	ID          string    `json:"id"`
	Path        string    `json:"path"`
	Name        string    `json:"name"`
	Content     string    `json:"content"`
	BaseContent string    `json:"baseContent"`
	SavedAt     time.Time `json:"savedAt"`
}

func recoveryDirectory() (string, error) {
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("无法定位恢复目录：%w", err)
	}
	return filepath.Join(cacheDir, "Mdmuder", "recovery"), nil
}

func validRecoveryID(id string) bool {
	if id == "" {
		return false
	}
	for _, r := range id {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '-' || r == '_' {
			continue
		}
		return false
	}
	return true
}

func recoveryDraftPath(dir, id string) string {
	if id == legacyRecoveryID {
		return filepath.Join(dir, recoveryFilename)
	}
	return filepath.Join(dir, id+".json")
}

func saveRecoveryDraft(dir string, draft *RecoveryDraft) error {
	if draft == nil {
		return errors.New("恢复草稿为空")
	}
	if draft.ID == "" {
		draft.ID = legacyRecoveryID
	}
	if !validRecoveryID(draft.ID) {
		return errors.New("恢复草稿标识无效")
	}
	if len(draft.Content) > maxDocumentBytes || len(draft.BaseContent) > maxDocumentBytes {
		return errors.New("恢复草稿过大")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("无法创建恢复目录：%w", err)
	}
	draft.SavedAt = time.Now().UTC()
	data, err := json.Marshal(draft)
	if err != nil {
		return fmt.Errorf("无法编码恢复草稿：%w", err)
	}
	if err := writeFileAtomicMode(recoveryDraftPath(dir, draft.ID), data, 0o600); err != nil {
		return fmt.Errorf("无法写入恢复草稿：%w", err)
	}
	return nil
}

func loadRecoveryDrafts(dir string) ([]*RecoveryDraft, error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("无法读取恢复草稿：%w", err)
	}

	drafts := make([]*RecoveryDraft, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		var draft RecoveryDraft
		if err := json.Unmarshal(data, &draft); err != nil || draft.SavedAt.IsZero() {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		if entry.Name() == recoveryFilename {
			id = legacyRecoveryID
		}
		if !validRecoveryID(id) {
			continue
		}
		draft.ID = id
		drafts = append(drafts, &draft)
	}

	sort.Slice(drafts, func(i, j int) bool {
		return drafts[i].SavedAt.Before(drafts[j].SavedAt)
	})
	return drafts, nil
}

func clearRecoveryDraft(dir, id string) error {
	if id == "" {
		return nil
	}
	if !validRecoveryID(id) {
		return errors.New("恢复草稿标识无效")
	}
	err := os.Remove(recoveryDraftPath(dir, id))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("无法清除恢复草稿：%w", err)
	}
	return nil
}

func clearRecoveryDrafts(dir string) error {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("无法读取恢复草稿：%w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".json") {
			continue
		}
		if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("无法清除恢复草稿：%w", err)
		}
	}
	return nil
}
