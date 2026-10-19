package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

const maxDocumentBytes = 32 << 20

func readDocumentFile(path string) (*Document, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, errors.New("文件路径为空")
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("无法解析文件路径：%w", err)
	}
	info, err := os.Stat(absPath)
	if err != nil {
		return nil, fmt.Errorf("无法读取文件：%w", err)
	}
	if info.IsDir() {
		return nil, errors.New("不能把文件夹作为文档打开")
	}
	if info.Size() > maxDocumentBytes {
		return nil, fmt.Errorf("文件过大（上限 %d MB）", maxDocumentBytes/(1<<20))
	}

	data, err := os.ReadFile(absPath)
	if err != nil {
		return nil, fmt.Errorf("无法读取文件：%w", err)
	}
	if bytes.IndexByte(data, 0) >= 0 {
		return nil, errors.New("该文件看起来是二进制文件，无法作为 Markdown 打开")
	}
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	if !utf8.Valid(data) {
		return nil, errors.New("文件不是有效的 UTF-8 编码，请先转换编码后再打开")
	}

	content := strings.ReplaceAll(string(data), "\r\n", "\n")
	content = strings.ReplaceAll(content, "\r", "\n")
	return &Document{
		Path:    absPath,
		Name:    filepath.Base(absPath),
		Content: content,
		Size:    int64(len(data)),
	}, nil
}

func writeFileAtomic(filename string, data []byte) error {
	return writeFileAtomicMode(filename, data, 0o644)
}

func writeFileAtomicMode(filename string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(filename)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	temp, err := os.CreateTemp(dir, ".mdmuder-save-*.tmp")
	if err != nil {
		return err
	}
	tempName := temp.Name()
	cleanup := func() {
		_ = temp.Close()
		_ = os.Remove(tempName)
	}

	if _, err := temp.Write(data); err != nil {
		cleanup()
		return err
	}
	if err := temp.Sync(); err != nil {
		cleanup()
		return err
	}
	if err := temp.Close(); err != nil {
		_ = os.Remove(tempName)
		return err
	}
	if err := os.Chmod(tempName, mode); err != nil {
		_ = os.Remove(tempName)
		return err
	}
	if err := os.Rename(tempName, filename); err != nil {
		_ = os.Remove(tempName)
		return err
	}
	return nil
}
