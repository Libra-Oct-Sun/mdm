(() => {
    "use strict";

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
    const desktop = window.runtime || null;
    const numberFormatter = new Intl.NumberFormat("zh-CN");
    const markdownSerializer = window.MdmuderMarkdown;
    if (!markdownSerializer) {
        throw new Error("Markdown serializer failed to load");
    }
    const findOwnCheckbox = markdownSerializer.findOwnCheckbox;
    const isIgnoredNode = markdownSerializer.isIgnoredNode;
    const editorSearch = window.MdmuderSearch;
    if (!editorSearch) {
        throw new Error("Editor search failed to load");
    }

    const TEXT_BLOCK_TAGS = new Set([
        "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6",
        "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "TABLE", "TR", "TD", "TH", "HR",
    ]);

    const ALLOWED_PASTE_TAGS = new Set([
        "P", "DIV", "BR", "H1", "H2", "H3", "H4", "H5", "H6",
        "STRONG", "B", "EM", "I", "DEL", "S", "STRIKE",
        "CODE", "PRE", "A", "IMG", "UL", "OL", "LI", "BLOCKQUOTE",
        "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "INPUT", "HR",
        "SPAN", "U", "MARK", "SUP", "SUB",
    ]);
    const BLOCKED_PASTE_TAGS = new Set([
        "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM",
        "META", "LINK", "TEMPLATE", "SVG", "MATH", "VIDEO", "AUDIO",
    ]);

    const WELCOME = [
        "# 欢迎使用 Mdmuder",
        "",
        "一个安静、快速的 Markdown 写作空间。现在正文会直接以排版后的形式呈现，Markdown 标记在后台保存。",
        "",
        "## 从这里开始",
        "",
        "- 使用顶部的 **打开** 载入已有 `.md` 文件",
        "- 直接把 Markdown 文件拖进窗口",
        "- 按 `Ctrl+S` 保存，按 `Ctrl+Shift+S` 另存为",
        "",
        "> 提示：点击左侧大纲里的标题，可以在长文档中快速定位。",
        "",
        "## 常用格式",
        "",
        "### 文本与强调",
        "",
        "**粗体**、*斜体*、~~删除线~~、`行内代码`。",
        "",
        "### 任务清单",
        "",
        "- [x] 打开 Mdmuder",
        "- [ ] 写下第一个标题",
        "- [ ] 完成今天的草稿",
        "",
        "### 表格",
        "",
        "| 快捷键 | 功能 |",
        "| --- | --- |",
        "| `Ctrl+S` | 保存 |",
        "| `Ctrl+F` | 查找 |",
        "| `Ctrl+B` | 粗体 |",
        "",
        "### 代码块",
        "",
        "```go",
        "package main",
        "",
        "func main() {",
        '    println("Happy writing")',
        "}",
        "```",
        "",
        "---",
        "",
        "写完后，别忘了保存。",
    ].join("\n");

    const state = {
        path: "",
        name: "未命名.md",
        dirty: false,
        savedContent: "",
        source: "",
        theme: "light",
        sidebar: true,
        fontSize: 16,
        headings: [],
        activeHeadingId: "",
        modalOpen: false,
        closePromptOpen: false,
        findMatches: [],
        findIndex: -1,
        findQuery: "",
    };

    const el = {
        app: $("#app"),
        docIdentity: $("#docIdentity"),
        docTitle: $("#docTitle"),
        docPath: $("#docPath"),
        dirtyDot: $("#dirtyDot"),
        editor: $("#editor"),
        editorPane: $("#editorPane"),
        editorScroll: $("#editorScroll"),
        outline: $("#outline"),
        statusSaved: $("#statusSaved"),
        statusPath: $("#statusPath"),
        statusBlock: $("#statusBlock"),
        statusStats: $("#statusStats"),
        sidebarWords: $("#sidebarWords"),
        sidebarLines: $("#sidebarLines"),
        sidebarReading: $("#sidebarReading"),
        toastHost: $("#toastHost"),
        modalBackdrop: $("#modalBackdrop"),
        modalTitle: $("#modalTitle"),
        modalMessage: $("#modalMessage"),
        modalActions: $("#modalActions"),
        moreMenu: $("#moreMenu"),
        btnMore: $("#btnMore"),
        findBar: $("#findBar"),
        findInput: $("#findInput"),
        findReplaceInput: $("#findReplaceInput"),
        findCount: $("#findCount"),
    };

    const history = {
        undo: [],
        redo: [],
        current: null,
        timer: 0,
        restoring: false,
    };

    let sourceTimer = 0;
    let historyTimer = 0;
    let outlineTimer = 0;
    let selectionFrame = 0;
    let scrollFrame = 0;
    let dragDepth = 0;
    let recoveryTimer = 0;
    let recoverySavedKey = "";
    let recoveryWarningShown = false;

    async function init() {
        loadPreferences();
        bindEvents();
        setupDesktopBridge();
        setTheme(state.theme, false);
        applyFontSize(state.fontSize, false);
        setSidebar(state.sidebar, false);

        await loadDocument(
            { path: "", name: "未命名.md", content: WELCOME, size: WELCOME.length },
            { focus: false, announce: false }
        );

        const startupPath = await safeCall("TakeStartupFile");
        if (startupPath) {
            const doc = await safeCall("OpenPath", startupPath);
            if (doc) {
                await loadDocument(doc, { focus: true, announce: true });
            }
        }
        await maybeRestoreRecoveryDraft();
        el.editor.focus();
        placeCaretAtStart();
    }

    function loadPreferences() {
        const savedTheme = readPreference("mdmuder.theme", "");
        if (savedTheme === "dark" || savedTheme === "light") {
            state.theme = savedTheme;
        } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
            state.theme = "dark";
        }
        state.sidebar = readPreference("mdmuder.sidebar", "true") !== "false";

        const savedFontSize = Number.parseInt(readPreference("mdmuder.fontSize", "16"), 10);
        if (Number.isFinite(savedFontSize)) {
            state.fontSize = clamp(savedFontSize, 13, 22);
        }
    }

    function readPreference(key, fallback) {
        try {
            const value = localStorage.getItem(key);
            return value === null ? fallback : value;
        } catch (error) {
            return fallback;
        }
    }

    function writePreference(key, value) {
        try {
            localStorage.setItem(key, String(value));
        } catch (error) {
            // Preferences are best-effort only.
        }
    }

    function bindEvents() {
        $("#btnSidebar").addEventListener("click", () => setSidebar(!state.sidebar));
        $("#btnSidebarClose").addEventListener("click", () => setSidebar(false));
        $("#btnTheme").addEventListener("click", () => {
            setTheme(state.theme === "dark" ? "light" : "dark");
        });
        $("#btnOpen").addEventListener("click", openDocument);
        $("#btnSave").addEventListener("click", () => saveDocument(false));
        $("#btnFind").addEventListener("click", openFind);

        el.btnMore.addEventListener("click", (event) => {
            event.stopPropagation();
            toggleMoreMenu();
        });
        document.addEventListener("click", (event) => {
            if (!event.target.closest(".more-wrap")) {
                closeMoreMenu();
            }
        });

        $$(".formatbar [data-command]").forEach((button) => {
            button.addEventListener("mousedown", (event) => event.preventDefault());
            button.addEventListener("click", () => executeCommand(button.dataset.command));
        });
        $$("#moreMenu [data-command]").forEach((button) => {
            button.addEventListener("click", () => {
                closeMoreMenu();
                executeCommand(button.dataset.command);
            });
        });

        el.editor.addEventListener("input", handleEditorInput);
        el.editor.addEventListener("keydown", handleEditorKeydown);
        el.editor.addEventListener("paste", handlePaste);
        el.editor.addEventListener("click", handleEditorClick);
        el.editor.addEventListener("blur", () => {
            scheduledSelectionUpdate();
        });
        document.addEventListener("selectionchange", () => {
            if (selectionInEditor()) {
                scheduledSelectionUpdate();
            }
        });
        document.addEventListener("keydown", handleGlobalKeydown);

        el.editorScroll.addEventListener("scroll", () => {
            if (scrollFrame) {
                return;
            }
            scrollFrame = requestAnimationFrame(() => {
                scrollFrame = 0;
                updateActiveHeadingFromScroll();
            });
        });

        el.findInput.addEventListener("input", () => refreshFind(false));
        el.findInput.addEventListener("keydown", handleFindKeydown);
        el.findReplaceInput.addEventListener("keydown", handleReplaceKeydown);
        $("#findPrev").addEventListener("click", () => findStep(-1));
        $("#findNext").addEventListener("click", () => findStep(1));
        $("#findClose").addEventListener("click", closeFind);
        $("#replaceOne").addEventListener("click", replaceCurrent);
        $("#replaceAll").addEventListener("click", replaceAll);

        window.addEventListener("dragenter", handleDragEnter);
        window.addEventListener("dragleave", handleDragLeave);
        window.addEventListener("dragover", (event) => {
            if (event.dataTransfer && Array.from(event.dataTransfer.types || []).includes("Files")) {
                event.preventDefault();
            }
        });
        window.addEventListener("drop", handleDragLeave);
        window.addEventListener("resize", () => scheduledSelectionUpdate());
    }

    function setupDesktopBridge() {
        if (!desktop) {
            return;
        }
        if (typeof desktop.EventsOn === "function") {
            desktop.EventsOn("app:close-requested", () => {
                handleCloseRequest();
            });
        }
        if (typeof desktop.OnFileDrop === "function") {
            desktop.OnFileDrop((x, y, paths) => {
                if (Array.isArray(paths) && paths.length) {
                    openDroppedPath(paths);
                }
            }, false);
        }
    }

    async function call(method, ...args) {
        const app = window.go && window.go.main && window.go.main.App;
        if (!app || typeof app[method] !== "function") {
            throw new Error("桌面接口尚未就绪，请重新启动 Mdmuder");
        }
        return app[method](...args);
    }

    async function safeCall(method, ...args) {
        try {
            return await call(method, ...args);
        } catch (error) {
            toast(errorText(error), "error");
            return undefined;
        }
    }

    function setTheme(theme, persist = true) {
        state.theme = theme === "dark" ? "dark" : "light";
        document.documentElement.dataset.theme = state.theme;
        if (persist) {
            writePreference("mdmuder.theme", state.theme);
        }
        try {
            if (state.theme === "dark") {
                desktop?.WindowSetDarkTheme?.();
            } else {
                desktop?.WindowSetLightTheme?.();
            }
        } catch (error) {
            // The title-bar theme is cosmetic.
        }
    }

    function setSidebar(visible, persist = true) {
        state.sidebar = Boolean(visible);
        el.app.classList.toggle("sidebar-hidden", !state.sidebar);
        $("#btnSidebar").setAttribute("aria-pressed", String(state.sidebar));
        if (persist) {
            writePreference("mdmuder.sidebar", String(state.sidebar));
        }
    }

    function applyFontSize(size, persist = true) {
        state.fontSize = clamp(Number(size) || 16, 13, 22);
        document.documentElement.style.setProperty("--editor-size", `${state.fontSize}px`);
        if (persist) {
            writePreference("mdmuder.fontSize", state.fontSize);
        }
    }

    async function loadDocument(doc, options = {}) {
        const content = typeof doc.content === "string" ? doc.content : "";
        state.path = doc.path || "";
        state.name = doc.name || (state.path ? fileNameFromPath(state.path) : "未命名.md");
        state.savedContent = content;
        state.source = content;
        state.dirty = false;
        state.headings = [];
        state.activeHeadingId = "";
        el.editorScroll.scrollTop = 0;
        el.findBar.hidden = true;

        await renderMarkdownToEditor(content);
        postProcessEditor();
        resetHistory();
        updateEmptyState();
        updateStats();
        updateDocumentMeta();
        refreshOutline();
        updateBlockStatus();
        setDirty(false, true);

        if (options.focus !== false) {
            el.editor.focus();
            placeCaretAtStart();
        }
        if (options.announce && state.path) {
            toast(`已打开 ${state.name}`, "success");
        }
    }

    async function renderMarkdownToEditor(markdown) {
        if (!markdown.trim()) {
            el.editor.innerHTML = "";
            return;
        }
        try {
            const result = await call("RenderMarkdown", markdown);
            el.editor.innerHTML = result?.html || "";
        } catch (error) {
            el.editor.textContent = markdown;
            toast(`文档渲染失败：${errorText(error)}`, "error");
        }
    }

    function postProcessEditor() {
        ensureHeadingIDs();
        prepareImages();
        prepareLinks();
        prepareCheckboxes();
        addCodeCopyButtons();
    }

    function ensureHeadingIDs() {
        const used = new Set();
        $$("h1, h2, h3, h4, h5, h6", el.editor).forEach((heading) => {
            const base = heading.id || slugify(heading.textContent || "section");
            let id = base;
            let suffix = 1;
            while (used.has(id)) {
                id = `${base}-${suffix}`;
                suffix += 1;
            }
            heading.id = id;
            used.add(id);
        });
    }

    function slugify(value) {
        const cleaned = String(value)
            .trim()
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s-]/gu, "")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");
        return cleaned || "section";
    }

    function prepareImages() {
        $$("img", el.editor).forEach((image) => {
            const raw = image.getAttribute("src") || "";
            let markdownSource = image.dataset.mdSrc || "";
            if (!markdownSource && raw.startsWith("/localfile/?p=")) {
                markdownSource = new URLSearchParams(raw.split("?")[1] || "").get("p") || raw;
            }
            if (!markdownSource) {
                markdownSource = raw;
            }
            image.dataset.mdSrc = markdownSource;
            image.contentEditable = "false";
            image.draggable = false;
            image.loading = "lazy";
            image.title = image.alt || markdownSource;

            if (isRelativeUrl(markdownSource) && state.path && !raw.startsWith("/localfile/")) {
                image.src = localFileURL(markdownSource);
            }
            if (!image.dataset.errorBound) {
                image.dataset.errorBound = "true";
                image.addEventListener("error", () => {
                    image.dataset.broken = "true";
                    if (image.alt) {
                        image.alt = `${image.alt}（图片无法加载）`;
                    } else {
                        image.alt = "图片无法加载";
                    }
                }, { once: true });
            }
        });
    }

    function prepareLinks() {
        $$("a[href]", el.editor).forEach((link) => {
            link.title = "Ctrl+点击打开链接";
        });
    }

    function prepareCheckboxes() {
        $$("input[type='checkbox']", el.editor).forEach((checkbox) => {
            checkbox.disabled = false;
            checkbox.contentEditable = "false";
            checkbox.setAttribute("aria-label", "切换任务状态");
        });
        $$("input:not([type='checkbox'])", el.editor).forEach((input) => input.remove());
    }

    function addCodeCopyButtons() {
        $$("pre", el.editor).forEach((pre) => {
            if (pre.querySelector(":scope > .code-copy")) {
                return;
            }
            const button = document.createElement("button");
            button.type = "button";
            button.className = "code-copy";
            button.contentEditable = "false";
            button.textContent = "复制";
            pre.append(button);
        });
    }

    function resetHistory() {
        history.undo = [];
        history.redo = [];
        window.clearTimeout(historyTimer);
        const selection = getSelectionPaths();
        history.current = {
            html: el.editor.innerHTML,
            start: selection?.start || null,
            end: selection?.end || null,
        };
    }

    function recordHistory() {
        if (history.restoring) {
            return;
        }
        window.clearTimeout(historyTimer);
        const html = el.editor.innerHTML;
        if (!history.current) {
            history.current = { html, start: null, end: null };
            return;
        }
        if (html === history.current.html) {
            return;
        }
        const selection = getSelectionPaths();
        history.undo.push(history.current);
        history.redo = [];
        history.current = {
            html,
            start: selection?.start || null,
            end: selection?.end || null,
        };
        if (history.undo.length > 60) {
            history.undo.shift();
        }
    }

    function undoEditor() {
        recordHistory();
        if (!history.undo.length) {
            return false;
        }
        const previous = history.undo.pop();
        if (history.current) {
            history.redo.push(history.current);
        }
        history.current = previous;
        restoreHistorySnapshot(previous);
        return true;
    }

    function redoEditor() {
        recordHistory();
        if (!history.redo.length) {
            return false;
        }
        const next = history.redo.pop();
        if (history.current) {
            history.undo.push(history.current);
        }
        history.current = next;
        restoreHistorySnapshot(next);
        return true;
    }

    function restoreHistorySnapshot(snapshot) {
        history.restoring = true;
        el.editor.innerHTML = snapshot.html;
        postProcessEditor();
        history.current = {
            html: el.editor.innerHTML,
            start: snapshot.start,
            end: snapshot.end,
        };
        restoreSelectionPaths(snapshot.start, snapshot.end);
        updateEmptyState();
        updateStats();
        refreshOutline();
        syncSourceNow();
        history.restoring = false;
    }

    function getSelectionPaths() {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) {
            return null;
        }
        const range = selection.getRangeAt(0);
        if (!el.editor.contains(range.startContainer) || !el.editor.contains(range.endContainer)) {
            return null;
        }
        return {
            start: { path: nodePath(range.startContainer), offset: range.startOffset },
            end: { path: nodePath(range.endContainer), offset: range.endOffset },
        };
    }

    function nodePath(node) {
        const path = [];
        let current = node;
        while (current && current !== el.editor) {
            const parent = current.parentNode;
            if (!parent) {
                return [];
            }
            path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
            current = parent;
        }
        return path;
    }

    function nodeFromPath(path) {
        let node = el.editor;
        if (!Array.isArray(path)) {
            return node;
        }
        for (const index of path) {
            if (!node || !node.childNodes[index]) {
                return null;
            }
            node = node.childNodes[index];
        }
        return node;
    }

    function restoreSelectionPaths(startPoint, endPoint) {
        el.editor.focus();
        if (!startPoint || !endPoint) {
            placeCaretAtStart();
            return;
        }
        const startNode = nodeFromPath(startPoint.path);
        const endNode = nodeFromPath(endPoint.path);
        if (!startNode || !endNode) {
            placeCaretAtStart();
            return;
        }
        try {
            const range = document.createRange();
            range.setStart(startNode, Math.min(startPoint.offset, nodeLength(startNode)));
            range.setEnd(endNode, Math.min(endPoint.offset, nodeLength(endNode)));
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        } catch (error) {
            placeCaretAtStart();
        }
    }

    function nodeLength(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.nodeValue.length;
        }
        return node.childNodes.length;
    }

    function placeCaretAtStart() {
        const range = document.createRange();
        range.selectNodeContents(el.editor);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function placeCaretAtEnd(node = el.editor) {
        const range = document.createRange();
        range.selectNodeContents(node);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function handleEditorInput(event) {
        if (history.restoring || (event && event.isComposing)) {
            return;
        }
        if (applyBlockMarkdownShortcut() || applyInlineMarkdownShortcut()) {
            return;
        }
        updateEmptyState();
        updateStats();
        scheduleOutlineRefresh();
        scheduleHistoryCommit();
        scheduleSourceSync();
        scheduleRecoveryDraft();
        if (!state.dirty) {
            setDirty(true);
        }
        if (!el.findBar.hidden) {
            refreshFind(true);
        }
    }

    function applyBlockMarkdownShortcut() {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) {
            return false;
        }
        const range = selection.getRangeAt(0);
        if (!range.collapsed) {
            return false;
        }
        const block = currentBlockElement();
        if (!block || block === el.editor || (block.tagName !== "P" && block.tagName !== "DIV")) {
            return false;
        }
        if (!caretAtEndOf(range, block)) {
            return false;
        }
        const text = (block.textContent || "").replace(/\u00a0/g, " ");
        const heading = text.match(/^(#{1,6})\s$/);
        const unordered = text.match(/^[-+*]\s$/);
        const ordered = text.match(/^\d+[.)]\s$/);
        const quote = text.match(/^>\s$/);
        if (!heading && !unordered && !ordered && !quote) {
            return false;
        }

        recordHistory();
        if (heading) {
            const element = document.createElement(`h${heading[1].length}`);
            element.innerHTML = "<br>";
            block.replaceWith(element);
            placeCaretAtStartIn(element);
        } else if (unordered || ordered) {
            const list = document.createElement(ordered ? "ol" : "ul");
            const item = document.createElement("li");
            item.innerHTML = "<br>";
            list.append(item);
            block.replaceWith(list);
            placeCaretAtStartIn(item);
        } else {
            const blockquote = document.createElement("blockquote");
            const paragraph = document.createElement("p");
            paragraph.innerHTML = "<br>";
            blockquote.append(paragraph);
            block.replaceWith(blockquote);
            placeCaretAtStartIn(paragraph);
        }
        afterMutation();
        return true;
    }

    function applyInlineMarkdownShortcut() {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) {
            return false;
        }
        const range = selection.getRangeAt(0);
        if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE) {
            return false;
        }
        const node = range.startContainer;
        if (node.parentElement?.closest("pre, code, a")) {
            return false;
        }
        const before = node.nodeValue.slice(0, range.startOffset);
        const patterns = [
            { expression: /\[([^\]\n]+)\]\(([^)\n]+)\)$/, tag: "a", content: 1, href: 2 },
            { expression: /(\*\*|__)([^*_\n]+)\1$/, tag: "strong", content: 2 },
            { expression: /~~([^~\n]+)~~$/, tag: "del", content: 1 },
            { expression: /`([^`\n]+)`$/, tag: "code", content: 1 },
            { expression: /(\*|_)([^*_\n]+)\1$/, tag: "em", content: 2 },
        ];
        for (const pattern of patterns) {
            const match = before.match(pattern.expression);
            if (!match) {
                continue;
            }
            recordHistory();
            const prefix = node.nodeValue.slice(0, range.startOffset - match[0].length);
            const suffix = node.nodeValue.slice(range.startOffset);
            const parent = node.parentNode;
            const beforeNode = prefix ? document.createTextNode(prefix) : null;
            const afterNode = document.createTextNode(suffix);
            const element = document.createElement(pattern.tag);
            element.textContent = match[pattern.content];
            if (pattern.href) {
                element.setAttribute("href", match[pattern.href]);
            }
            if (beforeNode) {
                parent.insertBefore(beforeNode, node);
            }
            parent.insertBefore(element, node);
            parent.insertBefore(afterNode, node);
            node.remove();

            const next = document.createRange();
            next.setStart(afterNode, 0);
            next.collapse(true);
            selection.removeAllRanges();
            selection.addRange(next);
            afterMutation();
            return true;
        }
        return false;
    }

    function scheduleHistoryCommit() {
        window.clearTimeout(historyTimer);
        historyTimer = window.setTimeout(recordHistory, 420);
    }

    function scheduleSourceSync() {
        window.clearTimeout(sourceTimer);
        sourceTimer = window.setTimeout(syncSourceNow, 120);
    }

    function syncSourceNow() {
        window.clearTimeout(sourceTimer);
        state.source = markdownSerializer.serializeEditor(el.editor);
        setDirty(state.source !== state.savedContent);
        return state.source;
    }

    function setDirty(value, force = false) {
        const changed = Boolean(value) !== state.dirty;
        state.dirty = Boolean(value);
        updateDocumentMeta();
        if (changed || force) {
            call("SetDirty", state.dirty).catch(() => {});
        }
        if (state.dirty) {
            scheduleRecoveryDraft();
        }
    }

    async function maybeRestoreRecoveryDraft() {
        const draft = await safeCall("LoadRecoveryDraft");
        if (!draft) {
            return;
        }
        const savedAt = new Date(draft.savedAt);
        const when = Number.isNaN(savedAt.getTime()) ? "上次会话" : savedAt.toLocaleString("zh-CN");
        const action = await showModal({
            title: "恢复未保存的草稿？",
            message: `发现“${draft.name || "未命名.md"}”在 ${when} 的未保存内容。恢复后会继续保留原文件，直到你再次保存。`,
            buttons: [
                { label: "丢弃草稿", value: "discard", kind: "danger" },
                { label: "恢复", value: "restore", kind: "primary" },
            ],
        });
        if (action !== "restore") {
            await clearRecoveryDraft();
            return;
        }

        await loadDocument(
            { path: draft.path || "", name: draft.name || "未命名.md", content: draft.content || "" },
            { focus: false, announce: false }
        );
        state.savedContent = draft.baseContent || "";
        syncSourceNow();
        const dirty = state.source !== state.savedContent;
        setDirty(dirty, true);
        if (dirty) {
            scheduleRecoveryDraft();
        } else {
            await clearRecoveryDraft();
        }
        toast("已恢复未保存的草稿", "success");
    }

    function scheduleRecoveryDraft() {
        if (!state.dirty) {
            return;
        }
        window.clearTimeout(recoveryTimer);
        recoveryTimer = window.setTimeout(() => {
            persistRecoveryDraft().catch(() => {});
        }, 1800);
    }

    async function persistRecoveryDraft() {
        if (!state.dirty) {
            return;
        }
        const content = syncSourceNow();
        if (!state.dirty) {
            await clearRecoveryDraft();
            return;
        }
        const key = [state.path, state.name, state.savedContent, content].join("\u0000");
        if (key === recoverySavedKey) {
            return;
        }
        try {
            await call("SaveRecoveryDraft", state.path, state.name, content, state.savedContent);
            recoverySavedKey = key;
        } catch (error) {
            if (!recoveryWarningShown) {
                recoveryWarningShown = true;
                toast(`无法写入恢复草稿：${errorText(error)}`, "error");
            }
        }
    }

    async function clearRecoveryDraft() {
        window.clearTimeout(recoveryTimer);
        recoverySavedKey = "";
        try {
            await call("ClearRecoveryDraft");
        } catch (error) {
            // A missing recovery file should never block normal document work.
        }
    }

    function updateDocumentMeta() {
        el.docTitle.textContent = state.name;
        el.docPath.textContent = state.path || "本地草稿，尚未保存";
        el.docIdentity.title = state.path || state.name;
        el.statusPath.textContent = state.path || "本地草稿";
        el.statusSaved.textContent = state.dirty ? "未保存" : (state.path ? "已保存" : "本地草稿");
        el.statusSaved.classList.toggle("is-dirty", state.dirty);
        el.dirtyDot.hidden = !state.dirty;

        const title = `${state.dirty ? "● " : ""}${state.name} — Mdmuder`;
        document.title = title;
        try {
            desktop?.WindowSetTitle?.(title);
        } catch (error) {
            // Ignore failures while the native window is being created.
        }
    }

    function updateEmptyState() {
        const text = el.editor.textContent.replace(/\u00a0/g, " ").trim();
        const hasBlock = el.editor.querySelector("img, hr, table, pre");
        el.editor.classList.toggle("is-empty", !text && !hasBlock);
    }

    function updateStats() {
        const text = editorPlainText();
        const characters = Array.from(text).length;
        const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
        const latinWords = (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
        const words = cjk + latinWords;
        const lines = text === "" ? 1 : text.split("\n").length;
        const readingMinutes = Math.max(1, Math.ceil((words || characters) / 300));

        el.sidebarWords.textContent = numberFormatter.format(words);
        el.sidebarLines.textContent = numberFormatter.format(lines);
        el.sidebarReading.textContent = `${readingMinutes} 分钟`;
        el.statusStats.textContent = `字数 ${numberFormatter.format(words)}，共 ${numberFormatter.format(lines)} 行`;
    }

    function editorPlainText() {
        let output = "";
        const walk = (node) => {
            for (const child of node.childNodes) {
                if (child.nodeType === Node.TEXT_NODE) {
                    output += child.nodeValue;
                    continue;
                }
                if (child.nodeType !== Node.ELEMENT_NODE || isIgnoredNode(child)) {
                    continue;
                }
                const tag = child.tagName;
                if (tag === "BR") {
                    output += "\n";
                    continue;
                }
                const isBlock = TEXT_BLOCK_TAGS.has(tag);
                if (isBlock && output && !output.endsWith("\n")) {
                    output += "\n";
                }
                walk(child);
                if (isBlock) {
                    output += "\n";
                }
            }
        };
        walk(el.editor);
        return output
            .replace(/\u00a0/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    function scheduledSelectionUpdate() {
        if (selectionFrame) {
            return;
        }
        selectionFrame = requestAnimationFrame(() => {
            selectionFrame = 0;
            updateBlockStatus();
            updateFormatState();
            updateActiveHeadingFromCaret();
        });
    }

    function selectionInEditor() {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) {
            return false;
        }
        return el.editor.contains(selection.anchorNode);
    }

    function currentBlockElement() {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) {
            return null;
        }
        let node = selection.anchorNode;
        if (!node || !el.editor.contains(node)) {
            return null;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            node = node.parentElement;
        }
        return node.closest("h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, td, th, div") || el.editor;
    }

    function currentBlockTag() {
        const block = currentBlockElement();
        if (!block || block === el.editor) {
            return "P";
        }
        return block.tagName;
    }

    function updateBlockStatus() {
        const tag = currentBlockTag();
        const labels = {
            H1: "标题 1", H2: "标题 2", H3: "标题 3",
            H4: "标题 4", H5: "标题 5", H6: "标题 6",
            LI: "列表", BLOCKQUOTE: "引用", PRE: "代码块",
            TD: "表格", TH: "表格",
        };
        el.statusBlock.textContent = labels[tag] || "段落";
    }

    function updateFormatState() {
        const tag = currentBlockTag();
        $$(".heading-group [data-command]").forEach((button) => {
            button.classList.toggle("is-active", button.dataset.command === `h${tag.slice(1)}`);
        });
        const states = {
            bold: "bold",
            italic: "italic",
            strike: "strikeThrough",
        };
        for (const [command, query] of Object.entries(states)) {
            let active = false;
            try {
                active = document.queryCommandState(query);
            } catch (error) {
                active = false;
            }
            const button = $(`[data-command="${command}"]`, document.querySelector(".formatbar"));
            button?.classList.toggle("is-active", active);
        }
        const inQuote = Boolean(currentBlockElement()?.closest("blockquote"));
        $('[data-command="quote"]', document.querySelector(".formatbar"))?.classList.toggle("is-active", inQuote);
        const list = currentBlockElement()?.closest("ul, ol");
        $('[data-command="ul"]', document.querySelector(".formatbar"))
            ?.classList.toggle("is-active", list?.tagName === "UL");
        $('[data-command="ol"]', document.querySelector(".formatbar"))
            ?.classList.toggle("is-active", list?.tagName === "OL");
    }

    function updateActiveHeadingFromCaret() {
        if (!state.headings.length) {
            return;
        }
        const block = currentBlockElement();
        if (!block) {
            return;
        }
        const heading = block.closest("h1, h2, h3, h4, h5, h6");
        if (!heading || !heading.id) {
            return;
        }
        if (state.activeHeadingId !== heading.id) {
            state.activeHeadingId = heading.id;
            updateOutlineActive();
        }
    }

    function updateActiveHeadingFromScroll() {
        if (!state.headings.length) {
            return;
        }
        const threshold = el.editorScroll.getBoundingClientRect().top + 120;
        let active = state.headings[0];
        for (const heading of state.headings) {
            if (heading.element.getBoundingClientRect().top <= threshold) {
                active = heading;
            } else {
                break;
            }
        }
        if (active && state.activeHeadingId !== active.id) {
            state.activeHeadingId = active.id;
            updateOutlineActive();
        }
    }

    function scheduleOutlineRefresh() {
        window.clearTimeout(outlineTimer);
        outlineTimer = window.setTimeout(refreshOutline, 180);
    }

    function refreshOutline() {
        window.clearTimeout(outlineTimer);
        ensureHeadingIDs();
        const headingElements = $$("h1, h2, h3, h4, h5, h6", el.editor);
        state.headings = headingElements.map((element) => ({
            level: Number(element.tagName.slice(1)),
            text: element.textContent.trim(),
            id: element.id,
            element,
        }));
        renderOutline();
        updateActiveHeadingFromScroll();
    }

    function renderOutline() {
        el.outline.replaceChildren();
        if (!state.headings.length) {
            const empty = document.createElement("div");
            empty.className = "outline-empty";
            const title = document.createElement("strong");
            title.textContent = "还没有标题";
            const hint = document.createElement("span");
            hint.textContent = "在正文中添加标题后，这里会生成可点击的大纲。";
            empty.append(title, hint);
            el.outline.append(empty);
            return;
        }

        state.headings.forEach((heading) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `outline-item level-${clamp(heading.level, 1, 6)}`;
            button.dataset.headingId = heading.id;
            button.title = heading.text || "未命名标题";

            const index = document.createElement("span");
            index.className = "outline-index";
            index.textContent = `H${heading.level}`;

            const label = document.createElement("span");
            label.className = "outline-label";
            label.textContent = heading.text || "未命名标题";

            button.append(index, label);
            button.addEventListener("click", () => jumpToHeading(heading));
            el.outline.append(button);
        });
        updateOutlineActive();
    }

    function updateOutlineActive() {
        $$(".outline-item", el.outline).forEach((button) => {
            button.classList.toggle("is-active", button.dataset.headingId === state.activeHeadingId);
        });
    }

    function jumpToHeading(heading) {
        state.activeHeadingId = heading.id;
        updateOutlineActive();
        heading.element.scrollIntoView({ behavior: "smooth", block: "start" });
        if (window.innerWidth < 980) {
            setSidebar(false);
        }
    }

    function executeCommand(command) {
        switch (command) {
            case "new":
                newDocument();
                break;
            case "open":
                openDocument();
                break;
            case "save-as":
                saveDocument(true);
                break;
            case "undo":
                undoEditor();
                break;
            case "redo":
                redoEditor();
                break;
            case "h1":
                applyHeading(1);
                break;
            case "h2":
                applyHeading(2);
                break;
            case "h3":
                applyHeading(3);
                break;
            case "bold":
                runInlineCommand("bold");
                break;
            case "italic":
                runInlineCommand("italic");
                break;
            case "strike":
                runInlineCommand("strikeThrough");
                break;
            case "inline-code":
                wrapSelectionWithTag("code", "代码");
                break;
            case "link":
                insertLink();
                break;
            case "image":
                insertImage();
                break;
            case "quote":
                toggleQuote();
                break;
            case "ul":
                runListCommand(false);
                break;
            case "ol":
                runListCommand(true);
                break;
            case "task":
                toggleTaskList();
                break;
            case "code-block":
                insertCodeBlock();
                break;
            case "insert-table":
                insertTable();
                break;
            case "insert-hr":
                insertHorizontalRule();
                break;
            case "find":
                openFind();
                break;
            case "font-smaller":
                changeFontSize(-1);
                break;
            case "font-larger":
                changeFontSize(1);
                break;
            case "font-reset":
                applyFontSize(16);
                toast("字号已重置为 16px", "info");
                break;
            case "shortcuts":
                showShortcuts();
                break;
            case "about":
                showAbout();
                break;
            default:
                break;
        }
    }

    function runInlineCommand(command) {
        if (!selectionInEditor()) {
            return;
        }
        recordHistory();
        el.editor.focus();
        safeExec(command);
        afterMutation();
    }

    function applyHeading(level) {
        if (!selectionInEditor()) {
            return;
        }
        const tag = currentBlockTag();
        if (tag === "LI" || tag === "TD" || tag === "TH") {
            toast("请在普通段落中使用标题", "info");
            return;
        }
        recordHistory();
        el.editor.focus();
        const target = tag === `H${level}` ? "p" : `h${level}`;
        safeExec("formatBlock", target);
        afterMutation();
    }

    function toggleQuote() {
        if (!selectionInEditor()) {
            return;
        }
        recordHistory();
        el.editor.focus();
        const block = currentBlockElement();
        const target = block?.closest("blockquote") ? "p" : "blockquote";
        safeExec("formatBlock", target);
        afterMutation();
    }

    function runListCommand(ordered) {
        if (!selectionInEditor()) {
            return;
        }
        recordHistory();
        el.editor.focus();
        safeExec(ordered ? "insertOrderedList" : "insertUnorderedList");
        afterMutation();
    }

    function safeExec(command, value = null) {
        try {
            return document.execCommand(command, false, value);
        } catch (error) {
            toast("当前编辑环境不支持这个格式操作", "error");
            return false;
        }
    }

    function toggleTaskList() {
        if (!selectionInEditor()) {
            return;
        }
        recordHistory();
        const block = currentBlockElement();
        const listItem = block?.closest("li");
        if (listItem) {
            const checkbox = findOwnCheckbox(listItem);
            if (checkbox) {
                checkbox.remove();
                if (listItem.firstChild && listItem.firstChild.nodeType === Node.TEXT_NODE) {
                    listItem.firstChild.nodeValue = listItem.firstChild.nodeValue.replace(/^\s/, "");
                }
                placeCaretAtEnd(listItem);
            } else {
                const box = makeCheckbox(false);
                listItem.prepend(box, document.createTextNode(" "));
                placeCaretAtEnd(listItem);
            }
            afterMutation();
            return;
        }
        if (!block || block === el.editor) {
            return;
        }
        const list = document.createElement("ul");
        const item = document.createElement("li");
        const paragraph = document.createElement("p");
        while (block.firstChild) {
            paragraph.append(block.firstChild);
        }
        item.append(makeCheckbox(false), document.createTextNode(" "), paragraph);
        list.append(item);
        block.replaceWith(list);
        placeCaretAtEnd(paragraph);
        afterMutation();
    }

    function makeCheckbox(checked) {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = Boolean(checked);
        box.contentEditable = "false";
        box.setAttribute("aria-label", "切换任务状态");
        return box;
    }

    function wrapSelectionWithTag(tagName, placeholder) {
        if (!selectionInEditor()) {
            return;
        }
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        recordHistory();
        const element = document.createElement(tagName);
        if (range.collapsed) {
            element.textContent = placeholder;
            range.insertNode(element);
            const next = document.createRange();
            next.selectNodeContents(element);
            selection.removeAllRanges();
            selection.addRange(next);
        } else {
            element.append(range.extractContents());
            range.insertNode(element);
            const next = document.createRange();
            next.selectNodeContents(element);
            selection.removeAllRanges();
            selection.addRange(next);
        }
        afterMutation();
    }

    async function insertLink() {
        if (!selectionInEditor()) {
            return;
        }
        const range = captureRange();
        const href = await showInputModal({
            title: "插入链接",
            message: "输入网页地址或相对路径。",
            value: "https://",
            placeholder: "https://example.com",
            confirmLabel: "插入",
        });
        if (href === null || !href.trim()) {
            restoreRange(range);
            return;
        }
        restoreRange(range);
        if (!selectionInEditor()) {
            return;
        }
        recordHistory();
        const selection = window.getSelection();
        const targetRange = selection.getRangeAt(0);
        const anchor = document.createElement("a");
        anchor.setAttribute("href", href.trim());
        if (targetRange.collapsed) {
            anchor.textContent = "链接文字";
            targetRange.insertNode(anchor);
            const textRange = document.createRange();
            textRange.selectNodeContents(anchor);
            selection.removeAllRanges();
            selection.addRange(textRange);
        } else {
            anchor.append(targetRange.extractContents());
            targetRange.insertNode(anchor);
            const after = document.createRange();
            after.setStartAfter(anchor);
            after.collapse(true);
            selection.removeAllRanges();
            selection.addRange(after);
        }
        afterMutation();
    }

    async function insertImage() {
        if (!selectionInEditor()) {
            return;
        }
        const range = captureRange();
        const source = await showInputModal({
            title: "插入图片",
            message: "输入图片网址，或相对于当前文档的路径。",
            value: "",
            placeholder: "images/photo.png",
            confirmLabel: "插入",
        });
        if (source === null || !source.trim()) {
            restoreRange(range);
            return;
        }
        restoreRange(range);
        if (!selectionInEditor()) {
            return;
        }
        const imageSource = source.trim();
        if (isRelativeUrl(imageSource) && !state.path) {
            toast("相对路径图片需要先保存文档", "info");
        }
        recordHistory();
        const image = document.createElement("img");
        image.alt = "";
        image.dataset.mdSrc = imageSource;
        image.src = isRelativeUrl(imageSource) ? localFileURL(imageSource) : imageSource;
        image.contentEditable = "false";
        image.draggable = false;
        const selection = window.getSelection();
        const targetRange = selection.getRangeAt(0);
        targetRange.deleteContents();
        targetRange.insertNode(image);
        const after = document.createRange();
        after.setStartAfter(image);
        after.collapse(true);
        selection.removeAllRanges();
        selection.addRange(after);
        afterMutation();
    }

    function insertCodeBlock() {
        if (!selectionInEditor()) {
            return;
        }
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        const selected = range.toString();
        const block = currentBlockElement();
        recordHistory();
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = selected || (block && block !== el.editor ? block.textContent : "") || "代码";
        pre.append(code);

        if (!range.collapsed) {
            range.deleteContents();
            if (block && block !== el.editor) {
                block.after(pre);
            } else {
                el.editor.append(pre);
            }
        } else if (block && block !== el.editor) {
            block.replaceWith(pre);
        } else {
            el.editor.append(pre);
        }
        const paragraph = document.createElement("p");
        paragraph.innerHTML = "<br>";
        pre.after(paragraph);
        placeCaretAtEnd(code);
        afterMutation();
    }

    function insertTable() {
        if (!selectionInEditor()) {
            return;
        }
        recordHistory();
        const table = document.createElement("table");
        table.innerHTML = [
            "<thead><tr><th>列 1</th><th>列 2</th></tr></thead>",
            "<tbody><tr><td>内容</td><td>内容</td></tr></tbody>",
        ].join("");
        const paragraph = document.createElement("p");
        paragraph.innerHTML = "<br>";
        const block = currentBlockElement();
        if (block && block !== el.editor) {
            block.after(table);
            table.after(paragraph);
        } else {
            el.editor.append(table, paragraph);
        }
        const cell = table.querySelector("th, td");
        if (cell) {
            placeCaretAtStartIn(cell);
        }
        afterMutation();
    }

    function insertHorizontalRule() {
        if (!selectionInEditor()) {
            return;
        }
        recordHistory();
        const block = currentBlockElement();
        const rule = document.createElement("hr");
        const paragraph = document.createElement("p");
        paragraph.innerHTML = "<br>";
        if (block && block !== el.editor) {
            block.after(rule);
            rule.after(paragraph);
        } else {
            el.editor.append(rule, paragraph);
        }
        placeCaretAtStartIn(paragraph);
        afterMutation();
    }

    function afterMutation() {
        postProcessEditor();
        recordHistory();
        updateEmptyState();
        updateStats();
        refreshOutline();
        syncSourceNow();
        scheduleRecoveryDraft();
        scheduledSelectionUpdate();
        el.editor.focus();
    }

    function handleEditorKeydown(event) {
        if (event.isComposing || event.keyCode === 229) {
            return;
        }
        if (!el.findBar.hidden && event.key === "Enter") {
            event.preventDefault();
            findStep(event.shiftKey ? -1 : 1);
            return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }

        if (event.key === "Tab") {
            event.preventDefault();
            handleTab(event.shiftKey);
            return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
            if (handleSpecialEnter(event)) {
                return;
            }
        }
    }

    function handleSpecialEnter(event) {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) {
            return false;
        }
        const range = selection.getRangeAt(0);
        if (!range.collapsed) {
            return false;
        }

        const pre = currentBlockElement()?.closest("pre");
        if (pre) {
            event.preventDefault();
            insertTextAtCaret("\n");
            return true;
        }

        const currentBlock = currentBlockElement();
        const blockText = (currentBlock?.textContent || "").replace(/\u00a0/g, " ").trim();
        if (currentBlock && currentBlock !== el.editor && /^([-*_])(?:\s*\1){2,}$/.test(blockText)) {
            event.preventDefault();
            recordHistory();
            const rule = document.createElement("hr");
            const paragraph = document.createElement("p");
            paragraph.innerHTML = "<br>";
            currentBlock.replaceWith(rule);
            rule.after(paragraph);
            placeCaretAtStartIn(paragraph);
            afterMutation();
            return true;
        }
        const fence = blockText.match(/^```([\w-]*)$/);
        if (fence && currentBlock && currentBlock !== el.editor) {
            event.preventDefault();
            recordHistory();
            const codeBlock = document.createElement("pre");
            const code = document.createElement("code");
            if (fence[1]) {
                code.className = `language-${fence[1]}`;
            }
            codeBlock.append(code);
            currentBlock.replaceWith(codeBlock);
            const paragraph = document.createElement("p");
            paragraph.innerHTML = "<br>";
            codeBlock.after(paragraph);
            placeCaretAtStartIn(code);
            afterMutation();
            return true;
        }

        const heading = currentBlockElement()?.closest("h1, h2, h3, h4, h5, h6");
        if (heading && caretAtEndOf(range, heading)) {
            event.preventDefault();
            recordHistory();
            const paragraph = document.createElement("p");
            paragraph.innerHTML = "<br>";
            heading.after(paragraph);
            placeCaretAtStartIn(paragraph);
            afterMutation();
            return true;
        }

        const listItem = currentBlockElement()?.closest("li");
        if (listItem) {
            const content = listItemText(listItem);
            if (!content.trim()) {
                event.preventDefault();
                recordHistory();
                exitListItem(listItem);
                afterMutation();
                return true;
            }
            if (findOwnCheckbox(listItem)) {
                event.preventDefault();
                recordHistory();
                const nextItem = document.createElement("li");
                nextItem.append(makeCheckbox(false), document.createTextNode(" "));
                listItem.after(nextItem);
                placeCaretAtEnd(nextItem);
                afterMutation();
                return true;
            }
        }
        return false;
    }

    function listItemText(listItem) {
        let text = "";
        const walk = (node) => {
            for (const child of node.childNodes) {
                if (child.nodeType === Node.TEXT_NODE) {
                    text += child.nodeValue;
                } else if (child.nodeType === Node.ELEMENT_NODE) {
                    if (child.tagName === "UL" || child.tagName === "OL") {
                        continue;
                    }
                    if (child.tagName === "INPUT") {
                        continue;
                    }
                    walk(child);
                }
            }
        };
        walk(listItem);
        return text;
    }

    function caretAtEndOf(range, element) {
        const tail = range.cloneRange();
        tail.selectNodeContents(element);
        tail.setStart(range.endContainer, range.endOffset);
        return tail.toString().trim() === "";
    }

    function exitListItem(listItem) {
        const list = listItem.parentElement;
        const paragraph = document.createElement("p");
        paragraph.innerHTML = "<br>";
        listItem.remove();
        if (list && !list.querySelector("li")) {
            list.replaceWith(paragraph);
        } else if (list) {
            list.after(paragraph);
        } else {
            listItem.after(paragraph);
        }
        placeCaretAtStartIn(paragraph);
    }

    function handleTab(outdent) {
        const block = currentBlockElement();
        const pre = block?.closest("pre");
        if (pre) {
            insertTextAtCaret("    ");
            return;
        }
        const listItem = block?.closest("li");
        if (listItem) {
            recordHistory();
            if (indentListItem(listItem, outdent)) {
                afterMutation();
                return;
            }
        }
        if (!outdent) {
            insertTextAtCaret("  ");
        }
    }

    function indentListItem(listItem, outdent) {
        const list = listItem.parentElement;
        if (!list || (list.tagName !== "UL" && list.tagName !== "OL")) {
            return false;
        }
        if (!outdent) {
            const previous = listItem.previousElementSibling;
            if (!previous) {
                return false;
            }
            let nested = Array.from(previous.children).find((child) => child.tagName === list.tagName);
            if (!nested) {
                nested = document.createElement(list.tagName);
                previous.append(nested);
            }
            nested.append(listItem);
            return true;
        }

        const parentListItem = list.parentElement?.closest("li");
        if (!parentListItem) {
            return false;
        }
        parentListItem.after(listItem);
        if (!list.querySelector("li")) {
            list.remove();
        }
        return true;
    }

    function insertTextAtCaret(text) {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) {
            return;
        }
        const range = selection.getRangeAt(0);
        recordHistory();
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        const after = document.createRange();
        after.setStartAfter(node);
        after.collapse(true);
        selection.removeAllRanges();
        selection.addRange(after);
        afterMutation();
    }

    function captureRange() {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) {
            return null;
        }
        const range = selection.getRangeAt(0);
        if (!el.editor.contains(range.commonAncestorContainer)) {
            return null;
        }
        return range.cloneRange();
    }

    function restoreRange(range) {
        if (!range) {
            el.editor.focus();
            return;
        }
        el.editor.focus();
        const selection = window.getSelection();
        selection.removeAllRanges();
        try {
            selection.addRange(range);
        } catch (error) {
            placeCaretAtEnd();
        }
    }

    function placeCaretAtStartIn(node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    async function handlePaste(event) {
        event.preventDefault();
        const clipboard = event.clipboardData;
        if (!clipboard) {
            return;
        }
        const range = captureRange();
        const imageFiles = clipboardImageFiles(clipboard);
        if (imageFiles.length) {
            await insertPastedImages(imageFiles, range);
            return;
        }
        const html = clipboard.getData("text/html");
        const text = clipboard.getData("text/plain");

        if (html) {
            recordHistory();
            const clean = sanitizePastedHTML(html);
            if (clean.trim()) {
                insertHTMLAtRange(clean, range);
                afterMutation();
            }
            return;
        }
        if (!text) {
            return;
        }
        if (looksLikeMarkdown(text)) {
            try {
                const result = await call("RenderMarkdown", text);
                recordHistory();
                insertHTMLAtRange(result?.html || textToHTML(text), range);
                afterMutation();
                return;
            } catch (error) {
                // Fall back to plain text below.
            }
        }
        recordHistory();
        insertHTMLAtRange(textToHTML(text), range);
        afterMutation();
    }

    function clipboardImageFiles(clipboard) {
        const files = [];
        if (clipboard.items) {
            for (const item of Array.from(clipboard.items)) {
                if (item.kind !== "file" || !String(item.type).startsWith("image/")) {
                    continue;
                }
                const file = item.getAsFile();
                if (file) {
                    files.push(file);
                }
            }
        }
        if (!files.length && clipboard.files) {
            for (const file of Array.from(clipboard.files)) {
                if (String(file.type).startsWith("image/")) {
                    files.push(file);
                }
            }
        }
        return files;
    }

    async function insertPastedImages(files, range) {
        if (!state.path) {
            const saved = await saveDocument(true);
            if (!saved) {
                toast("粘贴图片前需要先保存文档", "info");
                return;
            }
        }

        const savedImages = [];
        for (const file of files) {
            if (file.size > 20 * 1024 * 1024) {
                toast(`${file.name || "图片"} 超过 20 MB，已跳过`, "error");
                continue;
            }
            try {
                const dataURL = await readFileAsDataURL(file);
                const saved = await call("SavePastedImage", dataURL);
                if (saved?.relativePath) {
                    savedImages.push({ ...saved, name: file.name || "粘贴图片" });
                }
            } catch (error) {
                toast(`图片保存失败：${errorText(error)}`, "error");
            }
        }
        if (!savedImages.length) {
            return;
        }

        recordHistory();
        if (range) {
            restoreRange(range);
        }
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) {
            return;
        }
        const targetRange = selection.getRangeAt(0);
        targetRange.deleteContents();
        for (const saved of savedImages) {
            const image = document.createElement("img");
            image.alt = saved.name;
            image.dataset.mdSrc = saved.relativePath;
            image.src = localFileURL(saved.relativePath);
            image.contentEditable = "false";
            image.draggable = false;
            targetRange.insertNode(image);
            targetRange.setStartAfter(image);
            targetRange.collapse(true);
        }
        selection.removeAllRanges();
        selection.addRange(targetRange);
        el.editor.focus();
        afterMutation();
        toast(`已插入 ${savedImages.length} 张图片`, "success");
    }

    function readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(reader.error || new Error("无法读取剪贴板图片"));
            reader.readAsDataURL(file);
        });
    }

    function insertHTMLAtRange(html, range) {
        if (!range) {
            const fallback = document.createRange();
            fallback.selectNodeContents(el.editor);
            fallback.collapse(false);
            range = fallback;
        }
        const temp = document.createElement("div");
        temp.innerHTML = html;
        const nodes = Array.from(temp.childNodes);
        if (!nodes.length) {
            return;
        }
        const fragment = document.createDocumentFragment();
        nodes.forEach((node) => fragment.append(node));
        range.deleteContents();
        range.insertNode(fragment);
        const last = nodes[nodes.length - 1];
        const after = document.createRange();
        after.setStartAfter(last);
        after.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(after);
        el.editor.focus();
    }

    function looksLikeMarkdown(text) {
        return /(^|\n)#{1,6}\s|```|(^|\n)\s*[-*+]\s|(^|\n)\s*\d+[.)]\s|(^|\n)>\s|\*\*[^*\n]+\*\*|(^|\n)\|.+\|/m.test(text);
    }

    function textToHTML(text) {
        const normalized = String(text).replace(/\r\n?/g, "\n");
        return normalized
            .split(/\n{2,}/)
            .map((paragraph) => `<p>${escapeHTML(paragraph).replace(/\n/g, "<br>")}</p>`)
            .join("");
    }

    function sanitizePastedHTML(html) {
        const documentFragment = new DOMParser().parseFromString(html, "text/html");
        const root = documentFragment.body;
        root.querySelectorAll("button, .code-copy").forEach((node) => node.remove());
        root.querySelectorAll(Array.from(BLOCKED_PASTE_TAGS).map((tag) => tag.toLowerCase()).join(","))
            .forEach((node) => node.remove());

        let changed = true;
        while (changed) {
            changed = false;
            for (const element of Array.from(root.querySelectorAll("*"))) {
                if (!ALLOWED_PASTE_TAGS.has(element.tagName)) {
                    const fragment = document.createDocumentFragment();
                    while (element.firstChild) {
                        fragment.append(element.firstChild);
                    }
                    element.replaceWith(fragment);
                    changed = true;
                    break;
                }
            }
        }

        const allowedAttributes = {
            A: new Set(["href", "title"]),
            IMG: new Set(["src", "alt", "title"]),
            CODE: new Set(["class"]),
            OL: new Set(["start"]),
            INPUT: new Set(["type", "checked"]),
        };
        for (const element of Array.from(root.querySelectorAll("*"))) {
            const allowed = allowedAttributes[element.tagName] || new Set();
            for (const attribute of Array.from(element.attributes)) {
                if (!allowed.has(attribute.name.toLowerCase())) {
                    element.removeAttribute(attribute.name);
                }
            }
            if (element.tagName === "A") {
                const href = element.getAttribute("href") || "";
                if (!isSafeHref(href)) {
                    element.removeAttribute("href");
                }
            } else if (element.tagName === "IMG") {
                const src = element.getAttribute("src") || "";
                if (!isSafeImageSrc(src)) {
                    element.remove();
                    continue;
                }
            } else if (element.tagName === "INPUT") {
                if ((element.getAttribute("type") || "").toLowerCase() !== "checkbox") {
                    element.remove();
                    continue;
                }
                element.removeAttribute("disabled");
                element.setAttribute("type", "checkbox");
            } else if (element.tagName === "CODE") {
                const className = element.className || "";
                const language = className.match(/language-[\w-]+/);
                if (language) {
                    element.className = language[0];
                } else {
                    element.removeAttribute("class");
                }
            }
        }
        return root.innerHTML;
    }

    function isSafeHref(href) {
        const value = href.trim();
        if (!value) {
            return false;
        }
        if (/^javascript:/i.test(value) || /^data:/i.test(value)) {
            return false;
        }
        return /^(#|\/|\.\/|\.\.\/|https?:\/\/|mailto:)/i.test(value) || !/^[a-z][a-z0-9+.-]*:/i.test(value);
    }

    function isSafeImageSrc(src) {
        const value = src.trim();
        if (!value || /^javascript:/i.test(value)) {
            return false;
        }
        return /^(https?:\/\/|data:image\/|\/|\.\/|\.\.\/)/i.test(value) || !/^[a-z][a-z0-9+.-]*:/i.test(value);
    }

    function handleEditorClick(event) {
        const copyButton = event.target.closest(".code-copy");
        if (copyButton) {
            event.preventDefault();
            const pre = copyButton.closest("pre");
            const code = pre?.querySelector("code");
            copyText(code ? code.textContent : "").then((copied) => {
                if (!copied) {
                    toast("复制失败", "error");
                    return;
                }
                copyButton.textContent = "已复制";
                window.setTimeout(() => {
                    copyButton.textContent = "复制";
                }, 1200);
            });
            return;
        }

        const checkbox = event.target.closest("input[type='checkbox']");
        if (checkbox) {
            recordHistory();
            window.setTimeout(() => {
                afterMutation();
            }, 0);
            return;
        }

        const anchor = event.target.closest("a[href]");
        if (!anchor) {
            return;
        }
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
            openLink(anchor.getAttribute("href") || "");
            return;
        }
        const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
        if (caret && el.editor.contains(caret.startContainer)) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(caret);
        }
    }

    async function openLink(href) {
        if (!href) {
            return;
        }
        if (href.startsWith("#")) {
            const target = document.getElementById(decodeURIComponent(href.slice(1)));
            if (target) {
                target.scrollIntoView({ behavior: "smooth", block: "start" });
            }
            return;
        }
        if (/^(https?:|mailto:)/i.test(href)) {
            await safeCall("OpenExternal", href);
            return;
        }
        if (/\.(md|markdown|mdown|mkd|txt)(?:[?#].*)?$/i.test(href)) {
            if (!(await confirmUnsaved())) {
                return;
            }
            const resolved = await safeCall("ResolveDocumentLink", href);
            if (!resolved) {
                return;
            }
            const doc = await safeCall("OpenPath", resolved);
            if (doc) {
                await loadDocument(doc, { focus: true, announce: true });
            }
            return;
        }
        toast("暂不支持打开这个链接", "info");
    }

    function handleGlobalKeydown(event) {
        if (state.modalOpen) {
            return;
        }
        if (event.key === "Escape") {
            if (!el.findBar.hidden) {
                closeFind();
                return;
            }
            if (!el.moreMenu.hidden) {
                closeMoreMenu();
                return;
            }
        }

        const mod = event.ctrlKey || event.metaKey;
        if (!mod || event.altKey) {
            return;
        }
        const key = event.key.toLowerCase();
        if (key === "z" && !event.shiftKey) {
            if (undoEditor()) {
                event.preventDefault();
            }
            return;
        }
        if (key === "y" || (key === "z" && event.shiftKey)) {
            if (redoEditor()) {
                event.preventDefault();
            }
            return;
        }
        if (key === "s") {
            event.preventDefault();
            saveDocument(event.shiftKey);
        } else if (key === "o") {
            event.preventDefault();
            openDocument();
        } else if (key === "n") {
            event.preventDefault();
            newDocument();
        } else if (key === "b") {
            event.preventDefault();
            executeCommand("bold");
        } else if (key === "i") {
            event.preventDefault();
            executeCommand("italic");
        } else if (key === "k") {
            event.preventDefault();
            executeCommand("link");
        } else if (key === "f") {
            event.preventDefault();
            openFind();
        } else if (key === "h") {
            event.preventDefault();
            openFind(true);
        } else if (key === "\\") {
            event.preventDefault();
            setSidebar(!state.sidebar);
        } else if (key === "=" || key === "+") {
            event.preventDefault();
            changeFontSize(1);
        } else if (key === "-") {
            event.preventDefault();
            changeFontSize(-1);
        }
    }

    function changeFontSize(delta) {
        const next = clamp(state.fontSize + delta, 13, 22);
        if (next === state.fontSize) {
            return;
        }
        applyFontSize(next);
        toast(`正文字号 ${next}px`, "info");
    }

    function openFind(focusReplace = false) {
        el.findBar.hidden = false;
        const selection = window.getSelection();
        const selected = selection ? selection.toString() : "";
        if (selected && !selected.includes("\n")) {
            el.findInput.value = selected;
        }
        refreshFind(false);
        if (focusReplace) {
            el.findReplaceInput.focus();
            el.findReplaceInput.select();
        } else {
            el.findInput.focus();
            el.findInput.select();
        }
    }

    function closeFind() {
        el.findBar.hidden = true;
        el.editor.focus();
    }

    function handleFindKeydown(event) {
        if (event.key === "Enter") {
            event.preventDefault();
            findStep(event.shiftKey ? -1 : 1);
        } else if (event.key === "Escape") {
            event.preventDefault();
            closeFind();
        }
    }

    function handleReplaceKeydown(event) {
        if (event.key === "Enter") {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) {
                replaceAll();
            } else {
                replaceCurrent();
            }
        } else if (event.key === "Escape") {
            event.preventDefault();
            closeFind();
        }
    }

    function collectTextNodes() {
        const nodes = [];
        const walker = document.createTreeWalker(el.editor, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue || !node.parentElement) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (node.parentElement.closest(".code-copy")) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            },
        });
        let node;
        while ((node = walker.nextNode())) {
            nodes.push(node);
        }
        return nodes;
    }

    function refreshFind(preserveIndex) {
        const query = el.findInput.value;
        state.findQuery = query;
        if (!query) {
            state.findMatches = [];
            state.findIndex = -1;
            el.findCount.textContent = "0 / 0";
            return;
        }
        const matches = editorSearch.findMatches(collectTextNodes(), query);
        state.findMatches = matches;
        if (!preserveIndex || state.findIndex < 0 || state.findIndex >= matches.length) {
            state.findIndex = 0;
        }
        el.findCount.textContent = `${matches.length ? state.findIndex + 1 : 0} / ${matches.length}`;
    }

    function findStep(delta) {
        const query = el.findInput.value;
        if (!query) {
            return;
        }
        if (state.findQuery !== query || !state.findMatches.length) {
            refreshFind(false);
        }
        if (!state.findMatches.length) {
            el.findCount.textContent = "0 / 0";
            return;
        }
        state.findIndex = (state.findIndex + delta + state.findMatches.length) % state.findMatches.length;
        const match = state.findMatches[state.findIndex];
        const range = document.createRange();
        range.setStart(match.node, match.start);
        range.setEnd(match.node, match.end);
        el.editor.focus({ preventScroll: true });
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        el.findCount.textContent = `${state.findIndex + 1} / ${state.findMatches.length}`;

        const rect = range.getBoundingClientRect();
        const pane = el.editorScroll.getBoundingClientRect();
        if (rect.top < pane.top + 80 || rect.bottom > pane.bottom - 100) {
            el.editorScroll.scrollTop += rect.top - pane.top - 140;
        }
    }

    function replaceCurrent() {
        const query = el.findInput.value;
        if (!query) {
            return;
        }
        if (state.findQuery !== query || !state.findMatches.length) {
            refreshFind(true);
        }
        if (!state.findMatches.length) {
            toast("没有可替换的匹配", "info");
            return;
        }
        const replacement = el.findReplaceInput.value;
        if (replacement === query) {
            toast("替换内容与查找内容相同", "info");
            return;
        }
        const index = Math.max(0, Math.min(state.findIndex, state.findMatches.length - 1));
        recordHistory();
        if (!editorSearch.replaceMatch(state.findMatches[index], replacement)) {
            refreshFind(false);
            return;
        }
        afterMutation();
        refreshFind(true);
        if (state.findMatches.length) {
            state.findIndex = Math.min(index, state.findMatches.length - 1);
            findStep(0);
            el.findReplaceInput.focus();
        } else {
            el.findCount.textContent = "0 / 0";
            el.findReplaceInput.focus();
        }
    }

    function replaceAll() {
        const query = el.findInput.value;
        if (!query) {
            return;
        }
        refreshFind(false);
        if (!state.findMatches.length) {
            toast("没有可替换的匹配", "info");
            return;
        }
        const replacement = el.findReplaceInput.value;
        if (replacement === query) {
            toast("替换内容与查找内容相同", "info");
            return;
        }
        const matches = state.findMatches.slice();
        recordHistory();
        const replaced = editorSearch.replaceMatches(matches, replacement);
        if (!replaced) {
            return;
        }
        afterMutation();
        refreshFind(false);
        el.findReplaceInput.focus();
        toast(`已替换 ${replaced} 处`, "success");
    }

    async function openDocument() {
        if (!(await confirmUnsaved())) {
            return;
        }
        const doc = await safeCall("OpenFileDialog");
        if (doc) {
            await loadDocument(doc, { focus: true, announce: true });
            await clearRecoveryDraft();
        }
    }

    async function openDroppedPath(paths) {
        if (!(await confirmUnsaved())) {
            return;
        }
        if (paths.length > 1) {
            toast("一次只打开一个文件，已选择第一个", "info");
        }
        const doc = await safeCall("OpenPath", paths[0]);
        if (doc) {
            await loadDocument(doc, { focus: true, announce: true });
            await clearRecoveryDraft();
        }
    }

    async function saveDocument(saveAs) {
        const contentAtSave = syncSourceNow();
        const result = saveAs
            ? await safeCall("SaveDocumentAs", contentAtSave)
            : await safeCall("SaveDocument", state.path, contentAtSave);
        if (!result || result.canceled) {
            return false;
        }
        state.path = result.path || state.path;
        state.name = result.name || state.name;
        state.savedContent = contentAtSave;
        await clearRecoveryDraft();
        postProcessEditor();
        syncSourceNow();
        updateDocumentMeta();
        setDirty(state.source !== state.savedContent);
        toast("已保存", "success");
        return true;
    }

    async function newDocument() {
        if (!(await confirmUnsaved())) {
            return;
        }
        await safeCall("ResetDocument");
        await loadDocument(
            { path: "", name: "未命名.md", content: "", size: 0 },
            { focus: true, announce: false }
        );
        await clearRecoveryDraft();
    }

    async function confirmUnsaved() {
        if (!state.dirty) {
            return true;
        }
        const action = await showModal({
            title: "保存更改？",
            message: `“${state.name}” 有未保存的更改。继续前要保存吗？`,
            buttons: [
                { label: "取消", value: "cancel" },
                { label: "不保存", value: "discard", kind: "danger" },
                { label: "保存", value: "save", kind: "primary" },
            ],
        });
        if (action === "save") {
            return saveDocument(false);
        }
        return action === "discard";
    }

    async function handleCloseRequest() {
        if (state.closePromptOpen) {
            return;
        }
        if (state.modalOpen) {
            await safeCall("CancelQuit");
            return;
        }
        if (state.dirty) {
            await persistRecoveryDraft();
        }
        state.closePromptOpen = true;
        const action = await showModal({
            title: "退出 Mdmuder？",
            message: `“${state.name}” 尚未保存。你可以保存后退出，或放弃这次修改。`,
            buttons: [
                { label: "取消", value: "cancel" },
                { label: "不保存", value: "discard", kind: "danger" },
                { label: "保存并退出", value: "save", kind: "primary" },
            ],
        });
        state.closePromptOpen = false;

        if (action === "discard") {
            await clearRecoveryDraft();
            await safeCall("QuitApp");
        } else if (action === "save") {
            const saved = await saveDocument(false);
            if (saved) {
                await safeCall("QuitApp");
            } else {
                await safeCall("CancelQuit");
            }
        } else {
            await safeCall("CancelQuit");
        }
    }

    function showModal({ title, message, buttons, monospace = false }) {
        if (state.modalOpen) {
            return Promise.resolve("cancel");
        }
        state.modalOpen = true;
        const previouslyFocused = document.activeElement;
        el.modalTitle.textContent = title;
        el.modalMessage.textContent = message;
        el.modalMessage.classList.toggle("is-mono", monospace);
        el.modalActions.replaceChildren();
        el.modalBackdrop.hidden = false;

        return new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) {
                    return;
                }
                settled = true;
                state.modalOpen = false;
                el.modalBackdrop.hidden = true;
                el.modalMessage.classList.remove("is-mono");
                document.removeEventListener("keydown", onKey, true);
                el.modalBackdrop.removeEventListener("click", onBackdrop);
                if (previouslyFocused && typeof previouslyFocused.focus === "function") {
                    previouslyFocused.focus();
                }
                resolve(value);
            };
            const onKey = (event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    finish("cancel");
                    return;
                }
                if (event.key === "Tab") {
                    const focusable = Array.from(el.modalActions.querySelectorAll("button"))
                        .filter((button) => !button.disabled);
                    if (!focusable.length) {
                        return;
                    }
                    const first = focusable[0];
                    const last = focusable[focusable.length - 1];
                    if (!el.modalBackdrop.contains(document.activeElement)) {
                        event.preventDefault();
                        first.focus();
                    } else if (event.shiftKey && document.activeElement === first) {
                        event.preventDefault();
                        last.focus();
                    } else if (!event.shiftKey && document.activeElement === last) {
                        event.preventDefault();
                        first.focus();
                    }
                }
            };
            const onBackdrop = (event) => {
                if (event.target === el.modalBackdrop) {
                    finish("cancel");
                }
            };
            document.addEventListener("keydown", onKey, true);
            el.modalBackdrop.addEventListener("click", onBackdrop);
            buttons.forEach((config) => {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = config.label;
                if (config.kind) {
                    button.className = config.kind;
                }
                button.addEventListener("click", () => finish(config.value));
                el.modalActions.append(button);
            });
            requestAnimationFrame(() => {
                el.modalActions.querySelector(".primary")?.focus();
            });
        });
    }

    function showInputModal({ title, message, value, placeholder, confirmLabel }) {
        if (state.modalOpen) {
            return Promise.resolve(null);
        }
        state.modalOpen = true;
        const previouslyFocused = document.activeElement;
        el.modalTitle.textContent = title;
        el.modalMessage.textContent = message;
        el.modalMessage.classList.remove("is-mono");
        el.modalActions.replaceChildren();

        const input = document.createElement("input");
        input.className = "modal-input";
        input.type = "text";
        input.value = value || "";
        input.placeholder = placeholder || "";
        input.autocomplete = "off";
        input.spellcheck = false;
        el.modalMessage.after(input);
        el.modalBackdrop.hidden = false;

        return new Promise((resolve) => {
            let settled = false;
            const finish = (result) => {
                if (settled) {
                    return;
                }
                settled = true;
                state.modalOpen = false;
                el.modalBackdrop.hidden = true;
                input.remove();
                document.removeEventListener("keydown", onKey, true);
                el.modalBackdrop.removeEventListener("click", onBackdrop);
                if (previouslyFocused && typeof previouslyFocused.focus === "function") {
                    previouslyFocused.focus();
                }
                resolve(result);
            };
            const confirm = () => finish(input.value.trim() || null);
            const cancel = () => finish(null);
            const onKey = (event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    cancel();
                    return;
                }
                if (event.key === "Enter") {
                    event.preventDefault();
                    confirm();
                    return;
                }
                if (event.key === "Tab") {
                    const focusable = [input, ...Array.from(el.modalActions.querySelectorAll("button"))];
                    const first = focusable[0];
                    const last = focusable[focusable.length - 1];
                    if (!el.modalBackdrop.contains(document.activeElement)) {
                        event.preventDefault();
                        first.focus();
                    } else if (event.shiftKey && document.activeElement === first) {
                        event.preventDefault();
                        last.focus();
                    } else if (!event.shiftKey && document.activeElement === last) {
                        event.preventDefault();
                        first.focus();
                    }
                }
            };
            const onBackdrop = (event) => {
                if (event.target === el.modalBackdrop) {
                    cancel();
                }
            };
            document.addEventListener("keydown", onKey, true);
            el.modalBackdrop.addEventListener("click", onBackdrop);

            const cancelButton = document.createElement("button");
            cancelButton.type = "button";
            cancelButton.textContent = "取消";
            cancelButton.addEventListener("click", cancel);
            const confirmButton = document.createElement("button");
            confirmButton.type = "button";
            confirmButton.className = "primary";
            confirmButton.textContent = confirmLabel;
            confirmButton.addEventListener("click", confirm);
            el.modalActions.append(cancelButton, confirmButton);

            requestAnimationFrame(() => {
                input.focus();
                input.select();
            });
        });
    }

    function showShortcuts() {
        showModal({
            title: "键盘快捷键",
            message: [
                "新建文档          Ctrl+N",
                "打开文件          Ctrl+O",
                "保存              Ctrl+S",
                "另存为            Ctrl+Shift+S",
                "撤销 / 重做       Ctrl+Z / Ctrl+Y",
                "粗体              Ctrl+B",
                "斜体              Ctrl+I",
                "插入链接          Ctrl+K",
                "查找              Ctrl+F",
                "查找与替换        Ctrl+H",
                "显示/隐藏大纲     Ctrl+\\",
                "调整字号          Ctrl+加号 / Ctrl+减号",
            ].join("\n"),
            buttons: [{ label: "知道了", value: "ok", kind: "primary" }],
            monospace: true,
        });
    }

    function showAbout() {
        showModal({
            title: "Mdmuder 0.2.0",
            message: [
                "一个面向 Windows 的 Markdown 编辑器。",
                "",
                "Go, Wails, WebView2, Goldmark",
                "",
                "正文以排版后的形式编辑，文件在后台保存为 Markdown。",
            ].join("\n"),
            buttons: [{ label: "关闭", value: "ok", kind: "primary" }],
        });
    }

    function toggleMoreMenu() {
        const willOpen = el.moreMenu.hidden;
        el.moreMenu.hidden = !willOpen;
        el.btnMore.setAttribute("aria-expanded", String(willOpen));
    }

    function closeMoreMenu() {
        if (el.moreMenu.hidden) {
            return;
        }
        el.moreMenu.hidden = true;
        el.btnMore.setAttribute("aria-expanded", "false");
    }

    function handleDragEnter(event) {
        if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes("Files")) {
            return;
        }
        dragDepth += 1;
        el.app.classList.add("is-dragging");
    }

    function handleDragLeave(event) {
        if (event.type === "drop") {
            dragDepth = 0;
            el.app.classList.remove("is-dragging");
            return;
        }
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) {
            el.app.classList.remove("is-dragging");
        }
    }

    async function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (error) {
                // Fall back to the legacy clipboard path.
            }
        }
        const helper = document.createElement("textarea");
        helper.value = text;
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        helper.style.pointerEvents = "none";
        document.body.append(helper);
        helper.select();
        let copied = false;
        try {
            copied = document.execCommand("copy");
        } catch (error) {
            copied = false;
        }
        helper.remove();
        return copied;
    }

    function toast(message, type = "info") {
        const node = document.createElement("div");
        node.className = `toast ${type}`;
        node.textContent = message;
        el.toastHost.append(node);
        window.setTimeout(() => {
            node.classList.add("is-leaving");
            window.setTimeout(() => node.remove(), 220);
        }, 2400);
    }

    function isRelativeUrl(value) {
        return Boolean(value) && !/^(https?:|data:|file:|\/\/)/i.test(value) && !/^[a-z]:[\\/]/i.test(value);
    }

    function localFileURL(path) {
        return `/localfile/?p=${encodeURIComponent(path)}`;
    }

    function escapeHTML(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    function fileNameFromPath(path) {
        const parts = String(path).split(/[\\/]/);
        return parts[parts.length - 1] || "未命名.md";
    }

    function errorText(error) {
        if (!error) {
            return "发生未知错误";
        }
        return String(error.message || error);
    }

    init().catch((error) => {
        toast(errorText(error), "error");
    });
})();
