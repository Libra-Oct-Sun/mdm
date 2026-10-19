package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const maxPastedImageBytes = 20 << 20

// SavedImage describes an image copied beside the current Markdown document.
type SavedImage struct {
	Path         string `json:"path"`
	RelativePath string `json:"relativePath"`
}

func savePastedImage(docPath, dataURL string) (*SavedImage, error) {
	docPath = strings.TrimSpace(docPath)
	if docPath == "" {
		return nil, errors.New("请先保存文档，再粘贴图片")
	}

	mimeType, data, err := decodeImageDataURL(dataURL)
	if err != nil {
		return nil, err
	}
	detected := http.DetectContentType(data)
	if normalizeImageMIME(detected) != normalizeImageMIME(mimeType) {
		return nil, errors.New("图片内容与声明的格式不一致")
	}
	extension, ok := imageExtension(mimeType)
	if !ok {
		return nil, errors.New("不支持该图片格式")
	}

	absDoc, err := filepath.Abs(docPath)
	if err != nil {
		return nil, fmt.Errorf("无法解析文档路径：%w", err)
	}
	assetDir := filepath.Join(filepath.Dir(absDoc), "assets")
	if err := ensureAssetDirectory(assetDir); err != nil {
		return nil, err
	}

	name, err := pastedImageName(extension)
	if err != nil {
		return nil, err
	}
	path := filepath.Join(assetDir, name)
	if err := writeFileAtomicMode(path, data, 0o644); err != nil {
		return nil, fmt.Errorf("无法保存粘贴的图片：%w", err)
	}
	return &SavedImage{
		Path:         path,
		RelativePath: filepath.ToSlash(filepath.Join("assets", name)),
	}, nil
}

func decodeImageDataURL(dataURL string) (string, []byte, error) {
	if !strings.HasPrefix(dataURL, "data:") {
		return "", nil, errors.New("图片数据格式无效")
	}
	comma := strings.IndexByte(dataURL, ',')
	if comma < 0 {
		return "", nil, errors.New("图片数据格式无效")
	}
	meta := strings.TrimPrefix(dataURL[:comma], "data:")
	if !strings.HasSuffix(meta, ";base64") {
		return "", nil, errors.New("图片必须使用 base64 编码")
	}
	mimeType := strings.TrimSuffix(meta, ";base64")
	if normalizeImageMIME(mimeType) == "" {
		return "", nil, errors.New("不支持该图片格式")
	}
	encoded := dataURL[comma+1:]
	if len(encoded) > maxPastedImageBytes*4/3+8 {
		return "", nil, errors.New("图片过大（上限 20 MB）")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", nil, errors.New("图片数据损坏")
	}
	if len(data) == 0 {
		return "", nil, errors.New("图片内容为空")
	}
	if len(data) > maxPastedImageBytes {
		return "", nil, errors.New("图片过大（上限 20 MB）")
	}
	return mimeType, data, nil
}

func normalizeImageMIME(value string) string {
	switch strings.ToLower(strings.TrimSpace(strings.Split(value, ";")[0])) {
	case "image/png":
		return "image/png"
	case "image/jpeg", "image/jpg":
		return "image/jpeg"
	case "image/gif":
		return "image/gif"
	case "image/webp":
		return "image/webp"
	case "image/bmp":
		return "image/bmp"
	default:
		return ""
	}
}

func imageExtension(mimeType string) (string, bool) {
	switch normalizeImageMIME(mimeType) {
	case "image/png":
		return "png", true
	case "image/jpeg":
		return "jpg", true
	case "image/gif":
		return "gif", true
	case "image/webp":
		return "webp", true
	case "image/bmp":
		return "bmp", true
	default:
		return "", false
	}
}

func ensureAssetDirectory(path string) error {
	if err := os.MkdirAll(path, 0o755); err != nil {
		return fmt.Errorf("无法创建图片目录：%w", err)
	}
	return nil
}

func pastedImageName(extension string) (string, error) {
	random := make([]byte, 4)
	if _, err := rand.Read(random); err != nil {
		return "", fmt.Errorf("无法生成图片名称：%w", err)
	}
	return fmt.Sprintf(
		"pasted-%s-%s.%s",
		time.Now().Format("20060102-150405"),
		hex.EncodeToString(random),
		extension,
	), nil
}
