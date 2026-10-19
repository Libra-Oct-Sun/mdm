package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App holds the desktop process state shared by the Go backend and the WebView UI.
type App struct {
	ctx context.Context

	mu          sync.RWMutex
	docPath     string
	startupPath string
	dirty       bool
	forceClose  bool
	closePrompt bool
}

// Document is the payload returned after opening or saving a Markdown file.
type Document struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Content string `json:"content"`
	Size    int64  `json:"size"`
}

// SaveResult describes the outcome of a save operation.
type SaveResult struct {
	Path     string `json:"path"`
	Name     string `json:"name"`
	Canceled bool   `json:"canceled"`
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	for _, argument := range os.Args[1:] {
		if strings.HasPrefix(argument, "-") {
			continue
		}
		if !isMarkdownFile(argument) {
			continue
		}
		if path, err := filepath.Abs(argument); err == nil {
			a.startupPath = path
			break
		}
	}
}

func (a *App) domReady(ctx context.Context) {
	// The frontend owns the first-run experience.
}

func (a *App) shutdown(ctx context.Context) {}

// TakeStartupFile returns a document path passed on the command line once.
func (a *App) TakeStartupFile() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	path := a.startupPath
	a.startupPath = ""
	return path
}

// beforeClose prevents an accidental data loss when the window close button is used.
func (a *App) beforeClose(ctx context.Context) bool {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.forceClose || !a.dirty {
		return false
	}
	if a.closePrompt {
		return true
	}

	a.closePrompt = true
	runtime.EventsEmit(ctx, "app:close-requested")
	return true
}

// SetDirty lets the backend know whether the live editor has unsaved changes.
func (a *App) SetDirty(dirty bool) {
	a.mu.Lock()
	a.dirty = dirty
	a.mu.Unlock()
}

// CancelQuit dismisses the close confirmation dialog.
func (a *App) CancelQuit() {
	a.mu.Lock()
	a.closePrompt = false
	a.mu.Unlock()
}

// ResetDocument clears the backend document context for a new untitled buffer.
func (a *App) ResetDocument() {
	a.mu.Lock()
	a.docPath = ""
	a.dirty = false
	a.closePrompt = false
	a.mu.Unlock()
}

// QuitApp bypasses the dirty guard after the user has made a decision.
func (a *App) QuitApp() {
	a.mu.Lock()
	a.forceClose = true
	a.mu.Unlock()
	if a.ctx != nil {
		runtime.Quit(a.ctx)
	}
}

// OpenFileDialog asks Windows for a Markdown file and reads it.
func (a *App) OpenFileDialog() (*Document, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "打开 Markdown 文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown 文件 (*.md;*.markdown;*.mdown;*.txt)", Pattern: "*.md;*.markdown;*.mdown;*.txt"},
			{DisplayName: "所有文件 (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("无法打开文件选择器：%w", err)
	}
	if strings.TrimSpace(path) == "" {
		return nil, nil
	}
	return a.OpenPath(path)
}

// OpenPath reads a Markdown file from disk. It is also used for drag and drop.
func (a *App) OpenPath(path string) (*Document, error) {
	doc, err := readDocumentFile(path)
	if err != nil {
		return nil, err
	}

	a.mu.Lock()
	a.docPath = doc.Path
	a.dirty = false
	a.closePrompt = false
	a.mu.Unlock()

	return doc, nil
}

// SaveDocument writes content to path. An empty path opens the Save As dialog.
func (a *App) SaveDocument(path, content string) (*SaveResult, error) {
	if strings.TrimSpace(path) == "" {
		return a.SaveDocumentAs(content)
	}
	return a.saveToPath(path, content)
}

// SaveDocumentAs always prompts for a destination.
func (a *App) SaveDocumentAs(content string) (*SaveResult, error) {
	a.mu.RLock()
	currentPath := a.docPath
	a.mu.RUnlock()

	defaultName := "未命名.md"
	defaultDir := defaultDocumentDirectory()
	if currentPath != "" {
		defaultName = filepath.Base(currentPath)
		defaultDir = filepath.Dir(currentPath)
	}

	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:            "保存 Markdown 文件",
		DefaultDirectory: defaultDir,
		DefaultFilename:  defaultName,
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown 文件 (*.md)", Pattern: "*.md"},
			{DisplayName: "所有文件 (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("无法打开保存对话框：%w", err)
	}
	if strings.TrimSpace(path) == "" {
		return &SaveResult{Canceled: true}, nil
	}
	return a.saveToPath(path, content)
}

// SaveRecoveryDraft persists the latest unsaved editor snapshot.
func (a *App) SaveRecoveryDraft(path, name, content, baseContent string) error {
	dir, err := recoveryDirectory()
	if err != nil {
		return err
	}
	return saveRecoveryDraft(dir, &RecoveryDraft{
		Path:        path,
		Name:        name,
		Content:     content,
		BaseContent: baseContent,
	})
}

// LoadRecoveryDraft returns an unsaved snapshot left by a previous session.
func (a *App) LoadRecoveryDraft() (*RecoveryDraft, error) {
	dir, err := recoveryDirectory()
	if err != nil {
		return nil, err
	}
	return loadRecoveryDraft(dir)
}

// ClearRecoveryDraft removes the recovery snapshot after save or discard.
func (a *App) ClearRecoveryDraft() error {
	dir, err := recoveryDirectory()
	if err != nil {
		return err
	}
	return clearRecoveryDraft(dir)
}

// SavePastedImage stores clipboard image data beside the current document.
func (a *App) SavePastedImage(dataURL string) (*SavedImage, error) {
	a.mu.RLock()
	docPath := a.docPath
	a.mu.RUnlock()
	return savePastedImage(docPath, dataURL)
}

func (a *App) saveToPath(path, content string) (*SaveResult, error) {
	path = strings.TrimSpace(path)
	if filepath.Ext(path) == "" {
		path += ".md"
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("无法解析保存路径：%w", err)
	}
	if err := writeFileAtomic(absPath, []byte(content)); err != nil {
		return nil, fmt.Errorf("保存失败：%w", err)
	}

	a.mu.Lock()
	a.docPath = absPath
	a.dirty = false
	a.closePrompt = false
	a.mu.Unlock()

	return &SaveResult{Path: absPath, Name: filepath.Base(absPath)}, nil
}

// RenderMarkdown converts the current buffer into safe HTML and an outline.
func (a *App) RenderMarkdown(content string) RenderResult {
	a.mu.RLock()
	docPath := a.docPath
	a.mu.RUnlock()

	baseDir := ""
	if docPath != "" {
		baseDir = filepath.Dir(docPath)
	}
	return renderMarkdown(content, baseDir)
}

// ResolveDocumentLink turns a relative Markdown link into an absolute file path.
func (a *App) ResolveDocumentLink(href string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(href))
	if err != nil {
		return "", fmt.Errorf("链接格式无效：%w", err)
	}
	if parsed.Scheme != "" || parsed.Host != "" {
		return "", errors.New("仅支持本地 Markdown 链接")
	}
	relative, err := url.PathUnescape(parsed.Path)
	if err != nil {
		return "", errors.New("链接路径无效")
	}
	if relative == "" {
		return "", errors.New("链接路径为空")
	}
	if !isMarkdownFile(relative) {
		return "", errors.New("链接目标不是 Markdown 文件")
	}

	if !filepath.IsAbs(relative) {
		a.mu.RLock()
		docPath := a.docPath
		a.mu.RUnlock()
		if docPath == "" {
			return "", errors.New("请先保存当前文档，再打开相对链接")
		}
		relative = filepath.Join(filepath.Dir(docPath), filepath.FromSlash(relative))
	}
	absPath, err := filepath.Abs(relative)
	if err != nil {
		return "", fmt.Errorf("无法解析链接路径：%w", err)
	}
	if _, err := os.Stat(absPath); err != nil {
		return "", fmt.Errorf("链接目标不存在：%w", err)
	}
	return absPath, nil
}

// OpenExternal opens web links in the user's default browser.
func (a *App) OpenExternal(rawURL string) error {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return errors.New("链接格式无效")
	}
	switch strings.ToLower(parsed.Scheme) {
	case "http", "https", "mailto":
	default:
		return errors.New("出于安全考虑，只能打开网页或邮件链接")
	}
	runtime.BrowserOpenURL(a.ctx, rawURL)
	return nil
}

type localFileHandler struct {
	app *App
}

// ServeHTTP serves images referenced by the current document. It is used as the
// asset-server fallback and restricts requests to the document directory.
func (h *localFileHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet || !strings.HasPrefix(r.URL.Path, "/localfile/") {
		http.NotFound(w, r)
		return
	}

	a := h.app
	a.mu.RLock()
	docPath := a.docPath
	a.mu.RUnlock()
	if docPath == "" {
		http.Error(w, "document has not been saved", http.StatusForbidden)
		return
	}

	requested := r.URL.Query().Get("p")
	if requested == "" {
		http.NotFound(w, r)
		return
	}

	baseDir, err := filepath.Abs(filepath.Dir(docPath))
	if err != nil {
		http.Error(w, "invalid document directory", http.StatusInternalServerError)
		return
	}
	target, err := filepath.Abs(filepath.Join(baseDir, filepath.FromSlash(requested)))
	if err != nil {
		http.Error(w, "invalid file path", http.StatusBadRequest)
		return
	}
	relative, err := filepath.Rel(baseDir, target)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		http.Error(w, "file is outside the document directory", http.StatusForbidden)
		return
	}
	info, err := os.Stat(target)
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, target)
}

func defaultDocumentDirectory() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	documents := filepath.Join(home, "Documents")
	if info, err := os.Stat(documents); err == nil && info.IsDir() {
		return documents
	}
	return home
}
