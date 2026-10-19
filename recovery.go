package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const recoveryFilename = "draft.json"

// RecoveryDraft is the last unsaved editor state kept outside the document.
type RecoveryDraft struct {
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

func recoveryDraftPath(dir string) string {
	return filepath.Join(dir, recoveryFilename)
}

func saveRecoveryDraft(dir string, draft *RecoveryDraft) error {
	if draft == nil {
		return errors.New("恢复草稿为空")
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
	if err := writeFileAtomicMode(recoveryDraftPath(dir), data, 0o600); err != nil {
		return fmt.Errorf("无法写入恢复草稿：%w", err)
	}
	return nil
}

func loadRecoveryDraft(dir string) (*RecoveryDraft, error) {
	data, err := os.ReadFile(recoveryDraftPath(dir))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("无法读取恢复草稿：%w", err)
	}
	var draft RecoveryDraft
	if err := json.Unmarshal(data, &draft); err != nil {
		return nil, fmt.Errorf("恢复草稿已损坏：%w", err)
	}
	if draft.SavedAt.IsZero() {
		return nil, errors.New("恢复草稿缺少时间信息")
	}
	return &draft, nil
}

func clearRecoveryDraft(dir string) error {
	err := os.Remove(recoveryDraftPath(dir))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("无法清除恢复草稿：%w", err)
	}
	return nil
}
