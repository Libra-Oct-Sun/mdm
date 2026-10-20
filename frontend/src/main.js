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
    const tableTools = window.MdmuderTables;
    if (!tableTools) {
        throw new Error("Table editor tools failed to load");
    }
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
        "TABLE", "CAPTION", "COLGROUP", "COL", "THEAD", "TBODY", "TFOOT",
        "TR", "TH", "TD", "INPUT", "HR",
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
        "- 使用顶部的 **打开** 载入已有 `.md` 文件，继续打开会保留为新标签页",
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

    const tabs = [];
    let activeTabId = "";
    let tabCounter = 0;
    let recoveryIdCounter = 0;
    let tabsRenderKey = "";
    let tabOperationQueue = Promise.resolve();

    const el = {
        app: $("#app"),
        tabList: $("#tabList"),
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
        contextToolbar: $("#contextToolbar"),
        moreMenu: $("#moreMenu"),
        btnMore: $("#btnMore"),
        findBar: $("#findBar"),
        findInput: $("#findInput"),
        findReplaceInput: $("#findReplaceInput"),
        findCount: $("#findCount"),
    };

    let history = {
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
    let draggedTabId = "";
    let tabDropTarget = null;
    let selectedImage = null;
    let contextAnchor = null;
    let contextReturnRange = null;
    const recoveryTimers = new Map();
    const recoverySavedKeys = new Map();
    let recoveryGeneration = 0;
    let recoveryWarningShown = false;

    async function init() {
        loadPreferences();
        bindEvents();
        setupDesktopBridge();
        setTheme(state.theme, false);
        applyFontSize(state.fontSize, false);
        setSidebar(state.sidebar, false);

        await addDocumentTab(
            { path: "", name: "未命名.md", content: WELCOME, size: WELCOME.length },
            { focus: false, announce: false }
        );

        const startupPath = await safeCall("TakeStartupFile");
        if (startupPath) {
            const doc = await safeCall("OpenPath", startupPath);
            if (doc) {
                await addDocumentTab(doc, { focus: true, announce: true, replacePristine: true });
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
        $("#btnNewTab").addEventListener("click", () => newDocument());
        $("#btnSave").addEventListener("click", () => saveDocument(false));
        $("#btnFind").addEventListener("click", openFind);

        el.tabList.addEventListener("click", (event) => {
            const closeButton = event.target.closest("[data-tab-close]");
            if (closeButton) {
                event.stopPropagation();
                closeTab(closeButton.dataset.tabClose);
                return;
            }
            const tabButton = event.target.closest("[data-tab-id]");
            if (tabButton) {
                activateTab(tabButton.dataset.tabId);
            }
        });
        el.tabList.addEventListener("auxclick", (event) => {
            if (event.button !== 1) {
                return;
            }
            const tabButton = event.target.closest("[data-tab-id]");
            if (tabButton) {
                event.preventDefault();
                closeTab(tabButton.dataset.tabId);
            }
        });
        el.tabList.addEventListener("keydown", handleTabStripKeydown);
        el.tabList.addEventListener("dragstart", handleTabDragStart);
        el.tabList.addEventListener("dragover", handleTabDragOver);
        el.tabList.addEventListener("drop", handleTabDrop);
        el.tabList.addEventListener("dragend", handleTabDragEnd);

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
        el.editor.addEventListener("dblclick", handleEditorDoubleClick);
        el.editor.addEventListener("blur", () => {
            scheduledSelectionUpdate();
        });
        el.contextToolbar.addEventListener("mousedown", (event) => event.preventDefault());
        el.contextToolbar.addEventListener("click", handleContextToolbarClick);
        el.contextToolbar.addEventListener("keydown", handleContextToolbarKeydown);
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
                updateContextToolbar();
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

    function activeTab() {
        return tabs.find((tab) => tab.id === activeTabId) || null;
    }

    function tabById(id) {
        return tabs.find((tab) => tab.id === id) || null;
    }

    function queueTabOperation(operation) {
        const run = tabOperationQueue.then(operation, operation).catch((error) => {
            toast(errorText(error), "error");
        });
        tabOperationQueue = run;
        return run;
    }

    function newRecoveryId() {
        recoveryIdCounter += 1;
        const random = Math.random().toString(36).slice(2, 8);
        return `draft-${Date.now().toString(36)}-${random}-${recoveryIdCounter}`;
    }

    function createTab(doc) {
        const content = typeof doc.content === "string" ? doc.content : "";
        const path = doc.path || "";
        return {
            id: `document-${++tabCounter}`,
            path,
            name: doc.name || (path ? fileNameFromPath(path) : "未命名.md"),
            source: content,
            savedContent: content,
            dirty: false,
            html: "",
            scrollTop: 0,
            selection: null,
            history: null,
            recoveryId: doc.recoveryId || newRecoveryId(),
            loading: false,
            removed: false,
            recoveryVersion: 0,
        };
    }

    function isPristineTab(tab) {
        return Boolean(tab) && !tab.path && !tab.dirty && (tab.source === "" || tab.source === WELCOME);
    }

    function pathKey(path) {
        return path ? path.replace(/\\/g, "/").toLowerCase() : "";
    }

    function findTabByPath(path) {
        const key = pathKey(path);
        return key ? tabs.find((tab) => pathKey(tab.path) === key) || null : null;
    }

    function nextUntitledName() {
        const names = new Set(tabs.map((tab) => tab.name));
        if (!names.has("未命名.md")) {
            return "未命名.md";
        }
        let index = 2;
        while (names.has(`未命名 ${index}.md`)) {
            index += 1;
        }
        return `未命名 ${index}.md`;
    }

    function syncActiveTabFields(tab = activeTab()) {
        if (!tab) {
            return;
        }
        tab.path = state.path;
        tab.name = state.name;
        tab.source = state.source;
        tab.savedContent = state.savedContent;
        tab.dirty = state.dirty;
        tab.html = editorSnapshotHTML();
        tab.scrollTop = el.editorScroll.scrollTop;
    }

    function captureActiveTab() {
        const tab = activeTab();
        if (!tab || tab.loading) {
            return;
        }
        window.clearTimeout(historyTimer);
        syncSourceNow();
        recordHistory();
        tab.selection = getSelectionPaths();
        tab.history = {
            undo: history.undo.slice(),
            redo: history.redo.slice(),
            current: history.current,
        };
        syncActiveTabFields();
        persistRecoveryDraft(tab.id).catch(() => {});
    }

    function renderTabs(force = false) {
        const key = tabs
            .map((tab) => `${tab.id}\u0000${tab.name}\u0000${tab.path}\u0000${tab.dirty}\u0000${tab.id === activeTabId}`)
            .join("\u0001");
        if (!force && key === tabsRenderKey) {
            return;
        }
        tabsRenderKey = key;

        const fragment = document.createDocumentFragment();
        for (const tab of tabs) {
            const item = document.createElement("div");
            item.className = "tab";
            item.classList.toggle("is-active", tab.id === activeTabId);
            item.dataset.tabItemId = tab.id;

            const button = document.createElement("button");
            button.type = "button";
            button.id = `tab-button-${tab.id}`;
            button.className = "tab-main";
            button.dataset.tabId = tab.id;
            button.setAttribute("role", "tab");
            button.setAttribute("aria-selected", String(tab.id === activeTabId));
            button.setAttribute("aria-controls", "editorPane");
            button.tabIndex = tab.id === activeTabId ? 0 : -1;
            button.title = `${tab.path || tab.name}（拖动排序，Alt+←/→ 移动）`;
            button.draggable = true;

            const title = document.createElement("span");
            title.className = "tab-title";
            title.textContent = tab.name;
            const grip = document.createElement("span");
            grip.className = "tab-grip";
            grip.textContent = "⋮⋮";
            grip.setAttribute("aria-hidden", "true");
            button.append(grip, title);

            if (tab.dirty) {
                const dirty = document.createElement("span");
                dirty.className = "tab-dirty";
                dirty.setAttribute("aria-label", "有未保存的更改");
                button.append(dirty);
            }

            const close = document.createElement("button");
            close.type = "button";
            close.className = "tab-close";
            close.dataset.tabClose = tab.id;
            close.title = "关闭标签 (Ctrl+W)";
            close.setAttribute("aria-label", `关闭 ${tab.name}`);
            close.textContent = "×";

            item.append(button, close);
            fragment.append(item);
        }
        el.tabList.replaceChildren(fragment);

        const activeButton = el.tabList.querySelector(`[data-tab-id="${activeTabId}"]`);
        if (activeButton) {
            el.editorPane.setAttribute("aria-labelledby", activeButton.id);
            activeButton.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        } else {
            el.editorPane.removeAttribute("aria-labelledby");
        }
    }

    function addDocumentTab(doc, options = {}) {
        return queueTabOperation(() => addDocumentTabNow(doc, options));
    }

    async function addDocumentTabNow(doc, options = {}) {
        const existing = findTabByPath(doc.path);
        if (existing) {
            await activateTabNow(existing.id, { focus: options.focus });
            call("SetDirty", tabs.some((tab) => tab.dirty)).catch(() => {});
            if (options.announce) {
                toast(`已切换到 ${existing.name}`, "info");
            }
            return existing;
        }

        const current = activeTab();
        if (options.replacePristine && isPristineTab(current)) {
            current.recoveryId = doc.recoveryId || current.recoveryId;
            current.loading = true;
            try {
                await safeCall("SetActiveDocument", doc.path || "");
                await loadDocument(doc, options, current);
            } finally {
                current.loading = false;
            }
            return current;
        }

        captureActiveTab();
        const tab = createTab(doc);
        tabs.push(tab);
        activeTabId = tab.id;
        tab.loading = true;
        try {
            await safeCall("SetActiveDocument", doc.path || "");
            await loadDocument(doc, options, tab);
        } finally {
            tab.loading = false;
            renderTabs(true);
        }
        return tab;
    }

    function activateTab(id, options = {}) {
        return queueTabOperation(() => activateTabNow(id, options));
    }

    async function activateTabNow(id, options = {}) {
        const target = tabById(id);
        if (!target) {
            return;
        }
        if (target.id === activeTabId) {
            if (options.focus !== false) {
                el.editor.focus();
            }
            return;
        }

        const previousId = activeTabId;
        captureActiveTab();
        await safeCall("SetActiveDocument", target.path);
        if (activeTabId !== previousId) {
            return;
        }
        // The backend call yields to the UI; preserve edits made during it.
        captureActiveTab();
        activeTabId = target.id;

        state.path = target.path;
        state.name = target.name;
        state.source = target.source;
        state.savedContent = target.savedContent;
        state.dirty = target.dirty;
        state.headings = [];
        state.activeHeadingId = "";
        state.findMatches = [];
        state.findIndex = -1;
        state.findQuery = "";

        history = {
            undo: (target.history?.undo || []).slice(),
            redo: (target.history?.redo || []).slice(),
            current: target.history?.current || null,
            timer: 0,
            restoring: false,
        };

        el.findBar.hidden = true;
        el.findInput.value = "";
        el.findReplaceInput.value = "";
        el.findCount.textContent = "0 / 0";
        clearImageSelection();
        el.editor.innerHTML = target.html || "";
        postProcessEditor();
        if (!history.current) {
            resetHistory();
        }

        updateEmptyState();
        updateStats();
        updateDocumentMeta();
        refreshOutline();
        updateBlockStatus();
        setDirty(target.dirty, true);

        if (options.focus !== false) {
            restoreSelectionPaths(target.selection?.start, target.selection?.end);
        }
        // The editor still holds the previous tab's scroll offset here; do not
        // write it back into the target tab before restoring the saved value.
        el.editorScroll.scrollTop = target.scrollTop || 0;
        renderTabs(true);
        updateActiveHeadingFromScroll();
    }

    function switchTab(direction) {
        if (tabs.length < 2) {
            return;
        }
        const index = Math.max(0, tabs.findIndex((tab) => tab.id === activeTabId));
        const next = (index + direction + tabs.length) % tabs.length;
        activateTab(tabs[next].id);
    }

    function handleTabStripKeydown(event) {
        const currentButton = event.target.closest("[data-tab-id]");
        if (!currentButton) {
            return;
        }
        if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
            event.preventDefault();
            moveTabByOffset(
                currentButton.dataset.tabId,
                event.key === "ArrowRight" ? 1 : -1,
            );
            return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const index = tabs.findIndex((tab) => tab.id === currentButton.dataset.tabId);
            if (index === -1) {
                return;
            }
            const direction = event.key === "ArrowRight" ? 1 : -1;
            const next = tabs[(index + direction + tabs.length) % tabs.length];
            activateTab(next.id, { focus: false }).then(() => {
                el.tabList.querySelector(`[data-tab-id="${next.id}"]`)?.focus();
            });
        } else if (event.key === "Delete") {
            event.preventDefault();
            closeTab(currentButton.dataset.tabId);
        }
    }

    function handleTabDragStart(event) {
        const button = event.target.closest?.(".tab-main");
        if (!button?.dataset.tabId) {
            return;
        }
        draggedTabId = button.dataset.tabId;
        tabDropTarget = null;
        button.closest(".tab")?.classList.add("is-dragging");
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-mdmuder-tab", draggedTabId);
            event.dataTransfer.setData("text/plain", draggedTabId);
        }
    }

    function handleTabDragOver(event) {
        if (!draggedTabId) {
            return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
        }
        clearTabDropIndicator();
        const item = event.target.closest?.(".tab");
        if (!item) {
            tabDropTarget = { id: "", after: true };
            return;
        }
        const targetId = item.querySelector(".tab-main")?.dataset.tabId;
        if (!targetId || targetId === draggedTabId) {
            tabDropTarget = null;
            return;
        }
        const rect = item.getBoundingClientRect();
        const after = event.clientX >= rect.left + rect.width / 2;
        tabDropTarget = { id: targetId, after };
        item.classList.add(after ? "drop-after" : "drop-before");
    }

    function handleTabDrop(event) {
        if (!draggedTabId) {
            return;
        }
        event.preventDefault();
        const draggedId = draggedTabId;
        const target = tabDropTarget;
        cleanupTabDrag();
        if (target) {
            reorderTab(draggedId, target.id, target.after);
        }
    }

    function handleTabDragEnd() {
        cleanupTabDrag();
    }

    function clearTabDropIndicator() {
        el.tabList.querySelectorAll(".tab.drop-before, .tab.drop-after").forEach((item) => {
            item.classList.remove("drop-before", "drop-after");
        });
    }

    function cleanupTabDrag() {
        el.tabList.querySelectorAll(".tab.is-dragging").forEach((item) => {
            item.classList.remove("is-dragging");
        });
        clearTabDropIndicator();
        draggedTabId = "";
        tabDropTarget = null;
    }

    function focusTabButton(tabId) {
        el.tabList.querySelector(`.tab-main[data-tab-id="${tabId}"]`)?.focus();
    }

    function reorderTab(draggedId, targetId, after) {
        const fromIndex = tabs.findIndex((tab) => tab.id === draggedId);
        if (fromIndex === -1) {
            return;
        }
        const [moved] = tabs.splice(fromIndex, 1);
        let insertIndex = targetId
            ? tabs.findIndex((tab) => tab.id === targetId)
            : tabs.length;
        if (insertIndex === -1) {
            insertIndex = tabs.length;
        } else if (after) {
            insertIndex += 1;
        }
        insertIndex = Math.max(0, Math.min(insertIndex, tabs.length));
        if (insertIndex === fromIndex) {
            tabs.splice(fromIndex, 0, moved);
            focusTabButton(moved.id);
            return;
        }
        tabs.splice(insertIndex, 0, moved);
        renderTabs(true);
        focusTabButton(moved.id);
    }

    function moveTabByOffset(tabId, offset) {
        const index = tabs.findIndex((tab) => tab.id === tabId);
        const targetIndex = index + offset;
        if (index === -1 || targetIndex < 0 || targetIndex >= tabs.length) {
            focusTabButton(tabId);
            return;
        }
        const [moved] = tabs.splice(index, 1);
        tabs.splice(targetIndex, 0, moved);
        renderTabs(true);
        focusTabButton(moved.id);
    }

    async function loadDocument(doc, options = {}, targetTab = activeTab()) {
        const content = typeof doc.content === "string" ? doc.content : "";
        state.path = doc.path || "";
        state.name = doc.name || (state.path ? fileNameFromPath(state.path) : "未命名.md");
        state.savedContent = content;
        state.source = content;
        state.dirty = false;
        state.headings = [];
        state.activeHeadingId = "";
        state.findMatches = [];
        state.findIndex = -1;
        state.findQuery = "";
        el.editorScroll.scrollTop = 0;
        el.findBar.hidden = true;
        el.findInput.value = "";
        el.findReplaceInput.value = "";
        el.findCount.textContent = "0 / 0";
        clearImageSelection();

        await renderMarkdownToEditor(content);
        postProcessEditor();
        if (options.history) {
            history = options.history;
        } else {
            resetHistory();
        }
        updateEmptyState();
        updateStats();
        updateDocumentMeta();
        refreshOutline();
        updateBlockStatus();
        setDirty(false, true);
        syncActiveTabFields(targetTab);
        renderTabs(true);

        if (options.focus !== false) {
            el.editor.focus();
            if (options.scrollTop) {
                el.editorScroll.scrollTop = options.scrollTop;
            } else {
                placeCaretAtStart();
            }
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
            initializeImageMetadata(image);
            applyImageSize(image, image.dataset.mdWidth || "", image.dataset.mdHeight || "");
            image.contentEditable = "false";
            image.draggable = false;
            image.loading = "lazy";
            image.title = image.dataset.mdTitle || image.alt || markdownSource;

            if (isRelativeUrl(markdownSource) && state.path) {
                const localSource = localFileURL(markdownSource);
                if (raw !== localSource) {
                    image.src = localSource;
                }
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

    function initializeImageMetadata(image) {
        if (image.hasAttribute("data-md-title")) {
            return;
        }
        const parsed = markdownSerializer.parseImageTitle(image.getAttribute("title") || "");
        image.dataset.mdTitle = parsed.caption;
        if (parsed.width) {
            image.dataset.mdWidth = parsed.width;
        }
        if (parsed.height) {
            image.dataset.mdHeight = parsed.height;
        }
    }

    function applyImageSize(image, width, height) {
        const normalizedWidth = markdownSerializer.normalizeImageDimension(width);
        const normalizedHeight = markdownSerializer.normalizeImageDimension(height);
        if (normalizedWidth) {
            image.dataset.mdWidth = normalizedWidth;
            image.style.width = `${normalizedWidth}px`;
        } else {
            image.removeAttribute("data-md-width");
            image.style.width = "";
        }
        if (normalizedHeight) {
            image.dataset.mdHeight = normalizedHeight;
            image.style.height = `${normalizedHeight}px`;
        } else {
            image.removeAttribute("data-md-height");
            image.style.height = "";
        }
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
            html: editorSnapshotHTML(),
            start: selection?.start || null,
            end: selection?.end || null,
        };
    }

    function editorSnapshotHTML() {
        $$("input[type='checkbox']", el.editor).forEach((checkbox) => {
            if (checkbox.checked) {
                checkbox.setAttribute("checked", "");
            } else {
                checkbox.removeAttribute("checked");
            }
        });
        return el.editor.innerHTML;
    }

    function recordHistory() {
        if (history.restoring) {
            return;
        }
        window.clearTimeout(historyTimer);
        const html = editorSnapshotHTML();
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
        clearImageSelection();
        el.editor.innerHTML = snapshot.html;
        postProcessEditor();
        history.current = {
            html: editorSnapshotHTML(),
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
        if (activeTab()?.loading) {
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
        const tab = activeTab();
        if (tab) {
            tab.dirty = state.dirty;
        }
        updateDocumentMeta();
        if (changed || force) {
            call("SetDirty", tabs.some((item) => item.dirty)).catch(() => {});
        }
        if (state.dirty) {
            scheduleRecoveryDraft();
        }
    }

    async function maybeRestoreRecoveryDraft() {
        const drafts = await safeCall("LoadRecoveryDrafts");
        if (!Array.isArray(drafts) || !drafts.length) {
            return;
        }
        const latest = drafts[drafts.length - 1];
        const savedAt = new Date(latest.savedAt);
        const when = Number.isNaN(savedAt.getTime()) ? "上次会话" : savedAt.toLocaleString("zh-CN");
        const message = drafts.length === 1
            ? `发现“${latest.name || "未命名.md"}”在 ${when} 的未保存内容。恢复后会继续保留原文件，直到你再次保存。`
            : `发现 ${drafts.length} 个未保存的文档草稿，最近一次保存在 ${when}。恢复后会分别打开为独立标签。`;
        const action = await showModal({
            title: "恢复未保存的草稿？",
            message,
            buttons: [
                { label: "丢弃草稿", value: "discard", kind: "danger" },
                { label: "恢复", value: "restore", kind: "primary" },
            ],
        });
        if (action !== "restore") {
            await clearAllRecoveryDrafts();
            return;
        }

        let restored = 0;
        for (const draft of drafts) {
            try {
                await restoreRecoveryDraft(draft, restored === 0);
                restored += 1;
            } catch (error) {
                toast(`恢复草稿失败：${errorText(error)}`, "error");
            }
        }
        if (restored) {
            toast(restored === 1 ? "已恢复未保存的草稿" : `已恢复 ${restored} 个未保存草稿`, "success");
        }
    }

    async function restoreRecoveryDraft(draft, mayReplacePristine) {
        const content = typeof draft.content === "string" ? draft.content : "";
        const draftDocument = {
            path: draft.path || "",
            name: draft.name || "未命名.md",
            content,
            recoveryId: draft.id || newRecoveryId(),
        };
        const existing = findTabByPath(draftDocument.path);
        let tab;
        if (existing) {
            await activateTabNow(existing.id, { focus: false });
            existing.recoveryId = draftDocument.recoveryId;
            existing.loading = true;
            try {
                await loadDocument(draftDocument, { focus: false, announce: false }, existing);
            } finally {
                existing.loading = false;
            }
            tab = existing;
        } else {
            tab = await addDocumentTabNow(draftDocument, {
                focus: false,
                announce: false,
                replacePristine: mayReplacePristine,
            });
            tab.recoveryId = draftDocument.recoveryId;
        }

        state.savedContent = draft.baseContent || "";
        const source = syncSourceNow();
        const dirty = source !== state.savedContent;
        setDirty(dirty, true);
        syncActiveTabFields(tab);
        renderTabs(true);
        if (dirty) {
            scheduleRecoveryDraft(tab.id);
        } else {
            await clearTabRecoveryDraft(tab);
        }
    }

    function scheduleRecoveryDraft(tabId = activeTabId) {
        const tab = tabById(tabId);
        if (!tab || !tab.dirty || tab.loading) {
            return;
        }
        const existing = recoveryTimers.get(tab.id);
        if (existing) {
            window.clearTimeout(existing);
        }
        recoveryTimers.set(tab.id, window.setTimeout(() => {
            recoveryTimers.delete(tab.id);
            persistRecoveryDraft(tab.id).catch(() => {});
        }, 1800));
    }

    async function persistRecoveryDraft(tabId = activeTabId) {
        const tab = tabById(tabId);
        if (!tab || tab.loading) {
            return;
        }
        if (tab.id === activeTabId) {
            syncSourceNow();
            const pending = recoveryTimers.get(tab.id);
            if (pending) {
                window.clearTimeout(pending);
                recoveryTimers.delete(tab.id);
            }
        }
        if (!tab.dirty) {
            await clearTabRecoveryDraft(tab);
            return;
        }

        const content = tab.source;
        const key = [tab.path, tab.name, tab.savedContent, content].join("\u0000");
        if (recoverySavedKeys.get(tab.id) === key) {
            return;
        }
        const version = tab.recoveryVersion;
        const generation = recoveryGeneration;
        try {
            await call("SaveRecoveryDraft", tab.recoveryId, tab.path, tab.name, content, tab.savedContent);
            if (tab.removed || version !== tab.recoveryVersion || generation !== recoveryGeneration || !tabById(tab.id)) {
                await call("ClearRecoveryDraft", tab.recoveryId).catch(() => {});
                return;
            }
            recoverySavedKeys.set(tab.id, key);
        } catch (error) {
            if (!recoveryWarningShown) {
                recoveryWarningShown = true;
                toast(`无法写入恢复草稿：${errorText(error)}`, "error");
            }
        }
    }

    function clearTabRecoveryDraft(tab) {
        if (!tab) {
            return Promise.resolve();
        }
        const timer = recoveryTimers.get(tab.id);
        if (timer) {
            window.clearTimeout(timer);
        }
        recoveryTimers.delete(tab.id);
        recoverySavedKeys.delete(tab.id);
        tab.recoveryVersion += 1;
        return call("ClearRecoveryDraft", tab.recoveryId).catch(() => {});
    }

    async function clearAllRecoveryDrafts() {
        for (const timer of recoveryTimers.values()) {
            window.clearTimeout(timer);
        }
        recoveryTimers.clear();
        recoverySavedKeys.clear();
        recoveryGeneration += 1;
        try {
            await call("ClearRecoveryDrafts");
        } catch (error) {
            // A missing recovery directory should never block document work.
        }
    }

    function updateDocumentMeta() {
        const tab = activeTab();
        if (tab) {
            tab.path = state.path;
            tab.name = state.name;
            tab.source = state.source;
            tab.savedContent = state.savedContent;
            tab.dirty = state.dirty;
        }
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
        renderTabs();
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
            updateContextToolbar();
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
            case "close-tab":
                closeTab();
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
        const tabId = activeTabId;
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
        if (activeTabId !== tabId || !rangeInEditor(range)) {
            toast("标签已切换，插入链接操作已取消", "info");
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
        const tabId = activeTabId;
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
        if (activeTabId !== tabId || !rangeInEditor(range)) {
            toast("标签已切换，插入图片操作已取消", "info");
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

    async function openImageSettings(image) {
        if (!image?.isConnected) {
            return;
        }
        initializeImageMetadata(image);
        const tabId = activeTabId;
        const result = await showFormModal({
            title: "图片设置",
            message: "替代文本用于无障碍阅读；宽高以像素保存，留空表示按原图比例显示。",
            fields: [
                {
                    name: "alt",
                    label: "替代文本",
                    value: image.getAttribute("alt") || "",
                    placeholder: "描述图片内容",
                },
                {
                    name: "width",
                    label: "宽度（px）",
                    value: image.dataset.mdWidth || "",
                    placeholder: "自动",
                    type: "number",
                    min: "1",
                    max: "10000",
                    step: "1",
                    inputMode: "numeric",
                },
                {
                    name: "height",
                    label: "高度（px）",
                    value: image.dataset.mdHeight || "",
                    placeholder: "自动",
                    type: "number",
                    min: "1",
                    max: "10000",
                    step: "1",
                    inputMode: "numeric",
                },
            ],
            confirmLabel: "应用",
            validate(values) {
                return validateImageDimension(values.width, "宽度")
                    || validateImageDimension(values.height, "高度")
                    || "";
            },
        });
        if (!result || activeTabId !== tabId || !image.isConnected) {
            return;
        }
        recordHistory();
        image.setAttribute("alt", result.alt);
        applyImageSize(image, result.width, result.height);
        image.title = image.dataset.mdTitle || image.getAttribute("alt") || image.dataset.mdSrc || "";
        afterMutation();
    }

    function validateImageDimension(value, label) {
        const text = String(value || "").trim();
        if (!text) {
            return "";
        }
        if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 10000) {
            return `${label}需为 1–10000 之间的整数。`;
        }
        return "";
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

    function currentTableCell() {
        return currentBlockElement()?.closest("td, th") || null;
    }

    function selectionTableCell(node) {
        const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        return element?.closest?.("td, th") || null;
    }

    function selectedTableCells() {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) {
            return null;
        }
        const startCell = selectionTableCell(selection.anchorNode);
        const endCell = selectionTableCell(selection.focusNode);
        if (!startCell || !endCell || startCell === endCell) {
            return null;
        }
        const table = startCell.closest("table");
        if (!table || table !== endCell.closest("table")) {
            return null;
        }
        return { table, startCell, endCell };
    }

    function selectCellContents(cell) {
        const range = document.createRange();
        range.selectNodeContents(cell);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function executeTableAction(action) {
        const cell = currentTableCell();
        const table = cell?.closest("table");
        if (!cell || !table) {
            return;
        }
        recordHistory();
        if (action === "table-delete") {
            focusAfterRemovedTable(table);
            afterMutation();
            return;
        }

        let result = null;
        switch (action) {
        case "row-above":
            result = tableTools.insertRow(table, cell, "above");
            break;
        case "row-below":
            result = tableTools.insertRow(table, cell, "below");
            break;
        case "row-delete":
            result = tableTools.deleteRow(table, cell);
            break;
        case "col-before":
            result = tableTools.insertColumn(table, cell, "before");
            break;
        case "col-after":
            result = tableTools.insertColumn(table, cell, "after");
            break;
        case "col-delete":
            result = tableTools.deleteColumn(table, cell);
            break;
        case "merge": {
            const selection = selectedTableCells();
            if (!selection || selection.table !== table) {
                toast("请先跨单元格选择要合并的区域", "info");
                return;
            }
            result = tableTools.mergeCells(table, selection.startCell, selection.endCell);
            break;
        }
        case "split":
            result = tableTools.splitCell(table, cell);
            break;
        default:
            return;
        }

        if (action === "merge" && !result) {
            toast("请选择至少两个单元格进行合并", "info");
            return;
        }
        if (action === "split" && !result) {
            toast("当前单元格没有合并", "info");
            return;
        }
        if (result?.tableRemoved) {
            focusAfterRemovedTable(table);
        } else if (result?.cell) {
            selectCellContents(result.cell);
        }
        afterMutation();
    }

    function focusAfterRemovedTable(table) {
        const next = table.nextElementSibling;
        const previous = table.previousElementSibling;
        table.remove();
        const selectable = "p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th";
        const target = [next, previous].find((node) => node?.isConnected && node.matches(selectable));
        if (target) {
            placeCaretAtStartIn(target);
            return;
        }
        const paragraph = document.createElement("p");
        paragraph.innerHTML = "<br>";
        if (next?.isConnected) {
            next.before(paragraph);
        } else if (previous?.isConnected) {
            previous.after(paragraph);
        } else {
            el.editor.append(paragraph);
        }
        placeCaretAtStartIn(paragraph);
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
        if (activeTab()?.loading) {
            return;
        }
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

    function updateContextToolbar() {
        if (state.modalOpen) {
            hideContextToolbar();
            return;
        }
        const cell = currentTableCell();
        if (cell) {
            const mergeButton = $('[data-table-action="merge"]', el.contextToolbar);
            const splitButton = $('[data-table-action="split"]', el.contextToolbar);
            if (mergeButton) {
                mergeButton.disabled = !selectedTableCells();
            }
            if (splitButton) {
                splitButton.disabled = !((cell.rowSpan || 1) > 1 || (cell.colSpan || 1) > 1);
            }
            showContextToolbar("table", cell.closest("table"));
            return;
        }
        if (selectedImage && (!selectedImage.isConnected || !selectionTouchesImage(selectedImage))) {
            selectedImage.classList.remove("is-selected");
            selectedImage = null;
        }
        if (selectedImage?.isConnected) {
            showContextToolbar("image", selectedImage);
            return;
        }
        hideContextToolbar();
    }

    function showContextToolbar(kind, anchor) {
        if (!anchor) {
            hideContextToolbar();
            return;
        }
        contextAnchor = anchor;
        el.contextToolbar.hidden = false;
        el.contextToolbar.setAttribute("aria-label", kind === "table" ? "表格工具" : "图片工具");
        $$("[data-context]", el.contextToolbar).forEach((group) => {
            group.hidden = group.dataset.context !== kind;
        });
        positionContextToolbar();
    }

    function hideContextToolbar() {
        el.contextToolbar.hidden = true;
        contextAnchor = null;
        contextReturnRange = null;
    }

    function positionContextToolbar() {
        if (el.contextToolbar.hidden || !contextAnchor?.isConnected) {
            return;
        }
        const rect = contextAnchor.getBoundingClientRect();
        if ((rect.width || rect.height) && (rect.bottom < 8 || rect.top > window.innerHeight - 8)) {
            hideContextToolbar();
            return;
        }
        const width = el.contextToolbar.offsetWidth || 300;
        const height = el.contextToolbar.offsetHeight || 34;
        let left = rect.left + (rect.width - width) / 2;
        let top = rect.top - height - 8;
        if (top < 8) {
            top = rect.bottom + 8;
        }
        left = clamp(left, 8, Math.max(8, window.innerWidth - width - 8));
        top = clamp(top, 8, Math.max(8, window.innerHeight - height - 8));
        el.contextToolbar.style.left = `${Math.round(left)}px`;
        el.contextToolbar.style.top = `${Math.round(top)}px`;
    }

    function handleContextToolbarClick(event) {
        const tableButton = event.target.closest("[data-table-action]");
        if (tableButton) {
            executeTableAction(tableButton.dataset.tableAction);
            return;
        }
        const imageButton = event.target.closest("[data-image-action]");
        if (!imageButton || !selectedImage?.isConnected) {
            return;
        }
        if (imageButton.dataset.imageAction === "edit") {
            openImageSettings(selectedImage);
        } else if (imageButton.dataset.imageAction === "delete") {
            deleteSelectedImage();
        }
    }

    function handleContextToolbarKeydown(event) {
        if (event.key === "Escape") {
            event.preventDefault();
            restoreRange(contextReturnRange);
            contextReturnRange = null;
            scheduledSelectionUpdate();
        }
    }

    function selectImage(image) {
        if (!image || !el.editor.contains(image)) {
            return;
        }
        clearImageSelection();
        selectedImage = image;
        image.classList.add("is-selected");
        const range = document.createRange();
        range.selectNode(image);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        el.editor.focus();
        updateContextToolbar();
    }

    function clearImageSelection() {
        if (selectedImage) {
            selectedImage.classList.remove("is-selected");
            selectedImage = null;
        }
        if (!currentTableCell()) {
            hideContextToolbar();
        }
    }

    function selectionTouchesImage(image) {
        const selection = window.getSelection();
        if (!selection?.rangeCount || !image?.isConnected) {
            return false;
        }
        const range = selection.getRangeAt(0);
        try {
            return range.intersectsNode
                ? range.intersectsNode(image)
                : range.commonAncestorContainer === image || range.commonAncestorContainer.contains?.(image);
        } catch (error) {
            return false;
        }
    }

    function deleteSelectedImage() {
        if (!selectedImage?.isConnected) {
            return;
        }
        const image = selectedImage;
        recordHistory();
        image.remove();
        clearImageSelection();
        afterMutation();
    }

    function placeCaretBesideImage(image, after) {
        const range = document.createRange();
        if (after) {
            range.setStartAfter(image);
        } else {
            range.setStartBefore(image);
        }
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function handleEditorDoubleClick(event) {
        const image = event.target.closest("img");
        if (!image || !el.editor.contains(image)) {
            return;
        }
        event.preventDefault();
        selectImage(image);
        openImageSettings(image);
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
        if (event.altKey && event.key === "F10") {
            const first = Array.from(el.contextToolbar.querySelectorAll("button"))
                .find((button) => !button.closest("[hidden]"));
            if (first) {
                event.preventDefault();
                contextReturnRange = captureRange();
                first.focus();
            }
            return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }

        if ((event.key === "Delete" || event.key === "Backspace")
            && selectedImage?.isConnected
            && selectionTouchesImage(selectedImage)) {
            event.preventDefault();
            deleteSelectedImage();
            return;
        }
        if (event.key === "Tab" && selectedImage?.isConnected && selectionTouchesImage(selectedImage)) {
            event.preventDefault();
            placeCaretBesideImage(selectedImage, !event.shiftKey);
            clearImageSelection();
            scheduledSelectionUpdate();
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

        const cell = currentBlockElement()?.closest("td, th");
        if (cell && splitTableCellParagraph(cell, range)) {
            event.preventDefault();
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

    function splitTableCellParagraph(cell, range) {
        const startElement = range.startContainer.nodeType === Node.TEXT_NODE
            ? range.startContainer.parentElement
            : range.startContainer;
        const candidate = startElement?.closest?.("p, div");
        const block = candidate && cell.contains(candidate) ? candidate : null;

        if (block) {
            if (block.parentElement !== cell) {
                return false;
            }
            if (Array.from(block.children).some((child) => TEXT_BLOCK_TAGS.has(child.tagName))) {
                return false;
            }
            recordHistory();
            const second = document.createElement("p");
            second.append(range.extractContents());
            if (!second.textContent.trim() && !second.querySelector("img, br, input")) {
                second.innerHTML = "<br>";
            }
            if (!block.textContent.trim() && !block.querySelector("img, br, input")) {
                block.innerHTML = "<br>";
            }
            block.after(second);
            placeCaretAtStartIn(second);
            afterMutation();
            return true;
        }

        recordHistory();
        const beforeRange = document.createRange();
        beforeRange.selectNodeContents(cell);
        beforeRange.setEnd(range.startContainer, range.startOffset);
        const before = beforeRange.extractContents();
        const after = document.createDocumentFragment();
        while (cell.firstChild) {
            after.append(cell.firstChild);
        }
        const first = document.createElement("p");
        first.append(before);
        const second = document.createElement("p");
        second.append(after);
        if (!first.textContent.trim() && !first.querySelector("img, br, input")) {
            first.innerHTML = "<br>";
        }
        if (!second.textContent.trim() && !second.querySelector("img, br, input")) {
            second.innerHTML = "<br>";
        }
        cell.replaceChildren(first, second);
        placeCaretAtStartIn(second);
        afterMutation();
        return true;
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
        const cell = block?.closest("td, th");
        if (cell) {
            const table = cell.closest("table");
            if (table) {
                recordHistory();
                const moved = tableTools.moveCellFocus(table, cell, outdent ? -1 : 1);
                if (moved?.cell) {
                    selectCellContents(moved.cell);
                    afterMutation();
                }
                return;
            }
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

    function handlePaste(event) {
        event.preventDefault();
        if (activeTab()?.loading) {
            return;
        }
        const clipboard = event.clipboardData;
        if (!clipboard) {
            return;
        }
        const tabId = activeTabId;
        const range = captureRange();
        const imageFiles = clipboardImageFiles(clipboard);
        const html = clipboard.getData("text/html");
        const text = clipboard.getData("text/plain");
        queueTabOperation(() => applyPaste({ tabId, range, imageFiles, html, text })).catch(() => {});
    }

    async function applyPaste({ tabId, range, imageFiles, html, text }) {
        if (activeTabId !== tabId || !rangeInEditor(range)) {
            toast("标签已切换，粘贴操作已取消", "info");
            return;
        }
        if (imageFiles.length) {
            await insertPastedImages(imageFiles, range, tabId);
            return;
        }
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
                if (activeTabId !== tabId || !rangeInEditor(range)) {
                    toast("标签已切换，粘贴操作已取消", "info");
                    return;
                }
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

    function rangeInEditor(range) {
        return !range || (el.editor.contains(range.startContainer) && el.editor.contains(range.endContainer));
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

    async function insertPastedImages(files, range, tabId) {
        if (!state.path) {
            const saved = await saveDocumentNow(true);
            if (!saved) {
                toast("粘贴图片前需要先保存文档", "info");
                return;
            }
        }
        if (activeTabId !== tabId || !rangeInEditor(range)) {
            toast("标签已切换，粘贴操作已取消", "info");
            return;
        }

        const docPath = state.path;
        const savedImages = [];
        for (const file of files) {
            if (file.size > 20 * 1024 * 1024) {
                toast(`${file.name || "图片"} 超过 20 MB，已跳过`, "error");
                continue;
            }
            try {
                const dataURL = await readFileAsDataURL(file);
                if (activeTabId !== tabId) {
                    toast("标签已切换，粘贴操作已取消", "info");
                    return;
                }
                const saved = await call("SavePastedImage", dataURL, docPath);
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
        if (activeTabId !== tabId || !rangeInEditor(range)) {
            toast("图片已保存，但标签已切换，未插入正文", "info");
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
            TD: new Set(["colspan", "rowspan", "align"]),
            TH: new Set(["colspan", "rowspan", "align"]),
            COL: new Set(["span", "width"]),
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
            } else if (element.tagName === "TD" || element.tagName === "TH") {
                for (const name of ["colspan", "rowspan"]) {
                    const span = Number.parseInt(element.getAttribute(name) || "1", 10);
                    if (Number.isFinite(span) && span > 1 && span <= 1000) {
                        element.setAttribute(name, String(span));
                    } else {
                        element.removeAttribute(name);
                    }
                }
                const align = (element.getAttribute("align") || "").toLowerCase();
                if (!["left", "center", "right"].includes(align)) {
                    element.removeAttribute("align");
                } else {
                    element.setAttribute("align", align);
                }
            } else if (element.tagName === "COL") {
                const span = Number.parseInt(element.getAttribute("span") || "1", 10);
                if (Number.isFinite(span) && span > 1 && span <= 1000) {
                    element.setAttribute("span", String(span));
                } else {
                    element.removeAttribute("span");
                }
                const width = element.getAttribute("width") || "";
                if (!/^\d{1,5}%?$/.test(width)) {
                    element.removeAttribute("width");
                }
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
            afterMutation();
            return;
        }

        const image = event.target.closest("img");
        if (image && el.editor.contains(image)) {
            event.preventDefault();
            selectImage(image);
            return;
        }
        clearImageSelection();

        const anchor = event.target.closest("a[href]");
        if (!anchor) {
            return;
        }
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
            openLink(anchor.getAttribute("href") || "", activeTabId, state.path);
            return;
        }
        const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
        if (caret && el.editor.contains(caret.startContainer)) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(caret);
        }
    }

    function openLink(href, tabId = activeTabId, basePath = state.path) {
        return queueTabOperation(() => openLinkNow(href, tabId, basePath));
    }

    async function openLinkNow(href, tabId, basePath) {
        if (!href) {
            return;
        }
        if (activeTabId !== tabId) {
            toast("标签已切换，链接打开操作已取消", "info");
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
            if (activeTabId !== tabId) {
                toast("标签已切换，链接打开操作已取消", "info");
                return;
            }
            if (!basePath && !/^[a-z]:[\\/]|^\\\\/i.test(href)) {
                toast("请先保存当前文档，再打开相对链接", "info");
                return;
            }
            const resolved = await safeCall("ResolveDocumentLink", href, basePath);
            if (!resolved) {
                return;
            }
            if (activeTabId !== tabId) {
                toast("标签已切换，链接打开操作已取消", "info");
                return;
            }
            const doc = await safeCall("OpenPath", resolved);
            if (doc) {
                await addDocumentTabNow(doc, { focus: true, announce: true });
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
        if (key === "tab") {
            event.preventDefault();
            switchTab(event.shiftKey ? -1 : 1);
            return;
        }
        if (key === "pagedown" || key === "pageup") {
            event.preventDefault();
            switchTab(key === "pagedown" ? 1 : -1);
            return;
        }
        if (key === "w") {
            event.preventDefault();
            closeTab();
            return;
        }
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

    function openDocument() {
        return queueTabOperation(() => openDocumentNow());
    }

    async function openDocumentNow() {
        const doc = await safeCall("OpenFileDialog");
        if (doc) {
            await addDocumentTabNow(doc, { focus: true, announce: true, replacePristine: true });
        }
    }

    function openDroppedPath(paths) {
        return queueTabOperation(() => openDroppedPathNow(paths));
    }

    async function openDroppedPathNow(paths) {
        let replacePristine = true;
        for (const path of paths) {
            const doc = await safeCall("OpenPath", path);
            if (doc) {
                await addDocumentTabNow(doc, { focus: true, announce: true, replacePristine });
                replacePristine = false;
            }
        }
    }

    function saveDocument(saveAs) {
        return queueTabOperation(() => saveDocumentNow(saveAs));
    }

    async function saveDocumentNow(saveAs) {
        const tab = activeTab();
        if (!tab) {
            return false;
        }
        const contentAtSave = syncSourceNow();
        const needsPath = saveAs || !state.path;
        const openPaths = needsPath
            ? tabs.filter((item) => item.id !== tab.id && item.path).map((item) => item.path)
            : [];
        const result = needsPath
            ? await safeCall("SaveDocumentAs", contentAtSave, openPaths)
            : await safeCall("SaveDocument", state.path, contentAtSave);
        if (!result || result.canceled) {
            return false;
        }
        const conflict = findTabByPath(result.path);
        if (conflict && conflict.id !== tab.id) {
            toast(`“${result.name || result.path}”已在另一个标签中打开`, "error");
            return false;
        }
        state.path = result.path || state.path;
        state.name = result.name || state.name;
        state.savedContent = contentAtSave;
        postProcessEditor();
        syncSourceNow();
        updateDocumentMeta();
        setDirty(state.source !== state.savedContent);
        syncActiveTabFields(tab);
        await clearTabRecoveryDraft(tab);
        if (state.dirty) {
            scheduleRecoveryDraft(tab.id);
        }
        renderTabs(true);
        toast("已保存", "success");
        return true;
    }

    function newDocument() {
        return queueTabOperation(() => newDocumentNow());
    }

    async function newDocumentNow() {
        const current = activeTab();
        const name = isPristineTab(current) ? current.name : nextUntitledName();
        await addDocumentTabNow(
            { path: "", name, content: "", size: 0 },
            { focus: true, announce: false, replacePristine: true }
        );
    }

    function closeTab(id = activeTabId) {
        return queueTabOperation(() => closeTabNow(id));
    }

    async function closeTabNow(id = activeTabId) {
        const tab = tabById(id);
        if (!tab) {
            return;
        }

        const previousActiveId = activeTabId;
        const wasActive = tab.id === activeTabId;
        let activatedForClose = false;
        if (!wasActive && tab.dirty) {
            await activateTabNow(tab.id, { focus: false });
            activatedForClose = true;
        }

        if (tab.dirty && !(await confirmUnsaved())) {
            if (activatedForClose) {
                await activateTabNow(previousActiveId, { focus: false });
            }
            return;
        }

        const index = tabs.findIndex((item) => item.id === tab.id);
        if (index === -1) {
            return;
        }
        tabs.splice(index, 1);
        tabsRenderKey = "";
        tab.removed = true;
        await clearTabRecoveryDraft(tab);

        if (!tabs.length) {
            activeTabId = "";
            const blank = {
                path: "",
                name: "未命名.md",
                content: "",
                size: 0,
            };
            await safeCall("SetActiveDocument", "");
            await addDocumentTabNow(blank, { focus: true, announce: false });
            return;
        }

        if (activatedForClose) {
            const previous = tabById(previousActiveId);
            if (previous) {
                activeTabId = "";
                await activateTabNow(previous.id, { focus: false });
                return;
            }
        }

        if (tab.id === activeTabId) {
            const neighbor = tabs[Math.min(index, tabs.length - 1)];
            activeTabId = "";
            await activateTabNow(neighbor.id, { focus: true });
            return;
        }

        call("SetDirty", tabs.some((item) => item.dirty)).catch(() => {});
        renderTabs(true);
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
            return saveDocumentNow(false);
        }
        return action === "discard";
    }

    function handleCloseRequest() {
        return queueTabOperation(() => handleCloseRequestNow());
    }

    async function handleCloseRequestNow() {
        if (state.closePromptOpen) {
            return;
        }
        if (state.modalOpen) {
            await safeCall("CancelQuit");
            return;
        }
        captureActiveTab();
        const dirtyTabs = tabs.filter((tab) => tab.dirty);
        if (!dirtyTabs.length) {
            await clearAllRecoveryDrafts();
            await safeCall("QuitApp");
            return;
        }

        state.closePromptOpen = true;
        let quitting = false;
        try {
            for (const tab of dirtyTabs) {
                await activateTabNow(tab.id, { focus: false });
                await persistRecoveryDraft(tab.id);
                const action = await showModal({
                    title: "退出 Mdmuder？",
                    message: dirtyTabs.length > 1
                        ? `“${tab.name}” 尚未保存（共 ${dirtyTabs.length} 个文档有修改）。你可以保存后退出，或放弃这次修改。`
                        : `“${tab.name}” 尚未保存。你可以保存后退出，或放弃这次修改。`,
                    buttons: [
                        { label: "取消", value: "cancel" },
                        { label: "不保存", value: "discard", kind: "danger" },
                        { label: "保存并退出", value: "save", kind: "primary" },
                    ],
                });
                if (action === "cancel") {
                    await safeCall("CancelQuit");
                    return;
                }
                if (action === "discard") {
                    await clearTabRecoveryDraft(tab);
                    continue;
                }
                const saved = await saveDocumentNow(false);
                if (!saved) {
                    await safeCall("CancelQuit");
                    return;
                }
            }
            await clearAllRecoveryDrafts();
            quitting = true;
            await safeCall("QuitApp");
        } finally {
            state.closePromptOpen = false;
            if (!quitting) {
                call("SetDirty", tabs.some((tab) => tab.dirty)).catch(() => {});
                await safeCall("CancelQuit");
            }
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

    function showFormModal({ title, message, fields, confirmLabel, validate }) {
        if (state.modalOpen) {
            return Promise.resolve(null);
        }
        state.modalOpen = true;
        const previouslyFocused = document.activeElement;
        el.modalTitle.textContent = title;
        el.modalMessage.textContent = message;
        el.modalMessage.classList.remove("is-mono");
        el.modalActions.replaceChildren();

        const form = document.createElement("div");
        form.className = "modal-fields";
        form.id = "modalFields";
        const inputs = new Map();
        for (const field of fields) {
            const label = document.createElement("label");
            label.className = "modal-field";
            const caption = document.createElement("span");
            caption.textContent = field.label;
            const input = document.createElement("input");
            input.type = field.type || "text";
            input.name = field.name;
            input.value = field.value || "";
            input.placeholder = field.placeholder || "";
            input.autocomplete = "off";
            input.spellcheck = false;
            if (field.min !== undefined) {
                input.min = field.min;
            }
            if (field.max !== undefined) {
                input.max = field.max;
            }
            if (field.step !== undefined) {
                input.step = field.step;
            }
            if (field.inputMode) {
                input.inputMode = field.inputMode;
            }
            label.append(caption, input);
            form.append(label);
            inputs.set(field.name, input);
        }
        const error = document.createElement("p");
        error.className = "modal-error";
        error.hidden = true;
        error.setAttribute("role", "alert");
        el.modalMessage.after(form, error);
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
                form.remove();
                error.remove();
                document.removeEventListener("keydown", onKey, true);
                el.modalBackdrop.removeEventListener("click", onBackdrop);
                if (previouslyFocused && typeof previouslyFocused.focus === "function") {
                    previouslyFocused.focus();
                }
                resolve(result);
            };
            const confirm = () => {
                const values = Object.fromEntries(
                    Array.from(inputs, ([name, input]) => [name, input.value.trim()])
                );
                const messageText = validate?.(values) || "";
                if (messageText) {
                    error.textContent = messageText;
                    error.hidden = false;
                    return;
                }
                error.hidden = true;
                finish(values);
            };
            const cancel = () => finish(null);
            const onKey = (event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    cancel();
                    return;
                }
                if (event.key === "Enter" && event.target.tagName !== "BUTTON") {
                    event.preventDefault();
                    confirm();
                    return;
                }
                if (event.key === "Tab") {
                    const focusable = [
                        ...Array.from(inputs.values()),
                        ...Array.from(el.modalActions.querySelectorAll("button")),
                    ].filter((item) => !item.disabled);
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
                const firstInput = inputs.values().next().value;
                firstInput?.focus();
                firstInput?.select();
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
                "关闭当前标签      Ctrl+W",
                "切换标签          Ctrl+Tab / Ctrl+Shift+Tab",
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
            title: "Mdmuder 0.4.0",
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
