import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { JSDOM } from "jsdom";

const indexHTML = readFileSync(new URL("../frontend/src/index.html", import.meta.url), "utf8");
const serializerSource = readFileSync(new URL("../frontend/src/markdown-serializer.js", import.meta.url), "utf8");
const tablesSource = readFileSync(new URL("../frontend/src/editor-tables.js", import.meta.url), "utf8");
const searchSource = readFileSync(new URL("../frontend/src/editor-search.js", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../frontend/src/main.js", import.meta.url), "utf8");

function escapeHTML(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

async function waitFor(predicate, label) {
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
        if (predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${label}`);
}

async function bootEditor({
    recovery = null,
    startup = "",
    documents = {},
    openDialogs = [],
    setActiveDelay = 0,
    saveImageDelay = 0,
    renderMarkdown = null,
    readyText = "",
} = {}) {
    const dom = new JSDOM(indexHTML, {
        runScripts: "outside-only",
        pretendToBeVisual: true,
        url: "https://mdmuder.test/",
    });
    const calls = [];
    let backendDirty = false;
    const app = {
        async TakeStartupFile() {
            calls.push(["TakeStartupFile"]);
            return startup;
        },
        async OpenPath(path) {
            calls.push(["OpenPath", path]);
            // Mimic the historical backend behaviour so the frontend's
            // dirty-state resynchronisation is covered as well.
            backendDirty = false;
            return documents[path] || { path, name: "note.md", content: "# note", size: 6 };
        },
        async OpenFileDialog() {
            calls.push(["OpenFileDialog"]);
            return openDialogs.shift() || null;
        },
        async LoadRecoveryDrafts() {
            calls.push(["LoadRecoveryDrafts"]);
            return Array.isArray(recovery) ? recovery : (recovery ? [recovery] : []);
        },
        async ClearRecoveryDraft(id) {
            calls.push(["ClearRecoveryDraft", id]);
        },
        async ClearRecoveryDrafts() {
            calls.push(["ClearRecoveryDrafts"]);
        },
        async SaveRecoveryDraft(...args) {
            calls.push(["SaveRecoveryDraft", ...args]);
        },
        async SetDirty(...args) {
            backendDirty = Boolean(args[0]);
            calls.push(["SetDirty", ...args]);
        },
        async SetActiveDocument(...args) {
            calls.push(["SetActiveDocument", ...args]);
            if (setActiveDelay) {
                await new Promise((resolve) => setTimeout(resolve, setActiveDelay));
            }
        },
        async RenderMarkdown(markdown) {
            calls.push(["RenderMarkdown", markdown]);
            if (renderMarkdown) {
                return renderMarkdown(markdown);
            }
            return { html: `<pre>${escapeHTML(markdown)}</pre>`, headings: [] };
        },
        async SavePastedImage(dataURL, docPath) {
            calls.push(["SavePastedImage", dataURL, docPath]);
            if (saveImageDelay) {
                await new Promise((resolve) => setTimeout(resolve, saveImageDelay));
            }
            return { path: "C:\\notes\\assets\\paste.png", relativePath: "assets/paste.png" };
        },
        async SaveDocumentAs(content, openPaths) {
            calls.push(["SaveDocumentAs", content, openPaths]);
            return { path: "C:\\notes\\saved.md", name: "saved.md" };
        },
        async SaveDocument(path, content) {
            calls.push(["SaveDocument", path, content]);
            return { path, name: path.split(/[\\/]/).pop() };
        },
        async ResolveDocumentLink(href, basePath) {
            calls.push(["ResolveDocumentLink", href, basePath]);
            return href;
        },
    };

    dom.window.go = { main: { App: app } };
    dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    dom.window.eval(serializerSource);
    dom.window.eval(tablesSource);
    dom.window.eval(searchSource);
    dom.window.eval(mainSource);

    await waitFor(
        () => {
            const text = dom.window.document.querySelector("#editor")?.textContent || "";
            const startupContent = startup ? (documents[startup]?.content || "# note") : "";
            return startup
                ? text.includes(readyText || startupContent)
                : text.includes("欢迎使用 Mdmuder");
        },
        "editor initialization"
    );
    return { dom, calls, getDirty: () => backendDirty };
}

test("Ctrl+H opens find and replace and replaces all matches", async () => {
    const { dom } = await bootEditor();
    const document = dom.window.document;
    const editor = document.querySelector("#editor");
    editor.innerHTML = "<p>cat and CAT and cat</p>";

    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "h",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    }));
    assert.equal(document.querySelector("#findBar").hidden, false);

    const findInput = document.querySelector("#findInput");
    findInput.value = "cat";
    findInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    document.querySelector("#findReplaceInput").value = "dog";
    document.querySelector("#replaceAll").click();

    await waitFor(() => editor.textContent === "dog and dog and dog", "replace all");
    assert.equal(document.querySelector("#findCount").textContent, "0 / 0");
    dom.window.close();
});

test("a recovery draft can be restored from the startup prompt", async () => {
    const { dom, calls } = await bootEditor({
        recovery: {
            path: "",
            name: "恢复.md",
            content: "# recovered",
            baseContent: "# old",
            savedAt: new Date().toISOString(),
        },
    });
    const document = dom.window.document;
    await waitFor(() => document.querySelector("#modalBackdrop").hidden === false, "recovery prompt");

    document.querySelector("#modalActions .primary").click();
    await waitFor(
        () => document.querySelector("#editor").textContent.includes("# recovered"),
        "restored content"
    );
    assert.ok(calls.some(([name, dirty]) => name === "SetDirty" && dirty === true));
    dom.window.close();
});

test("pasted clipboard images are saved and inserted with a relative path", async () => {
    const { dom, calls } = await bootEditor({ startup: "C:\\notes\\note.md" });
    const document = dom.window.document;
    const editor = document.querySelector("#editor");
    editor.innerHTML = "<p>before</p>";
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = dom.window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const file = new dom.window.File([new Uint8Array([1, 2, 3])], "paste.png", { type: "image/png" });
    const event = new dom.window.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
        value: {
            items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
            files: [file],
            getData: () => "",
        },
    });
    editor.dispatchEvent(event);

    await waitFor(() => editor.querySelector("img") !== null, "pasted image insertion");
    const image = editor.querySelector("img");
    assert.equal(image.dataset.mdSrc, "assets/paste.png");
    assert.equal(image.getAttribute("src"), "/localfile/?p=assets%2Fpaste.png");
    assert.ok(calls.some(([name, dataURL]) => name === "SavePastedImage" && dataURL.startsWith("data:image/png;base64,")));
    dom.window.close();
});

test("unsaved edits are written to the recovery draft after a pause", async () => {
    const { dom, calls } = await bootEditor({ startup: "C:\\notes\\note.md" });
    const editor = dom.window.document.querySelector("#editor");
    editor.innerHTML = "<p>unsaved text</p>";
    editor.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    await waitFor(
        () => calls.some(([name, , , , content]) => name === "SaveRecoveryDraft" && content.includes("unsaved text")),
        "recovery draft write"
    );
    dom.window.close();
});

test("opening another document creates a tab and keeps the first buffer intact", async () => {
    const firstPath = "C:\\notes\\first.md";
    const secondPath = "C:\\notes\\second.md";
    const { dom, calls } = await bootEditor({
        startup: firstPath,
        documents: {
            [firstPath]: { path: firstPath, name: "first.md", content: "# first", size: 7 },
            [secondPath]: { path: secondPath, name: "second.md", content: "# second", size: 8 },
        },
        openDialogs: [{ path: secondPath, name: "second.md", content: "# second", size: 8 }],
    });
    const document = dom.window.document;
    const editor = document.querySelector("#editor");

    editor.innerHTML = "<p>first draft</p>";
    editor.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "o",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    }));

    await waitFor(() => document.querySelectorAll("#tabList .tab").length === 2, "second document tab");
    assert.match(document.querySelector(".tab.is-active .tab-title").textContent, /second\.md/);
    assert.match(editor.textContent, /# second/);

    const firstTab = Array.from(document.querySelectorAll("#tabList [data-tab-id]"))
        .find((button) => button.textContent.includes("first.md"));
    firstTab.click();

    await waitFor(() => editor.textContent.includes("first draft"), "first document restored");
    assert.match(document.querySelector(".tab.is-active .tab-title").textContent, /first\.md/);
    assert.ok(document.querySelector(".tab.is-active .tab-dirty"));
    assert.ok(calls.some(([name, path]) => name === "SetActiveDocument" && path === secondPath));
    assert.ok(calls.some(([name, path]) => name === "SetActiveDocument" && path === firstPath));
    dom.window.close();
});

test("each tab keeps its own scroll position when switching", async () => {
    const firstPath = "C:\\notes\\first.md";
    const secondPath = "C:\\notes\\second.md";
    const { dom } = await bootEditor({
        startup: firstPath,
        documents: {
            [firstPath]: { path: firstPath, name: "first.md", content: "# first", size: 7 },
            [secondPath]: { path: secondPath, name: "second.md", content: "# second", size: 8 },
        },
        openDialogs: [{ path: secondPath, name: "second.md", content: "# second", size: 8 }],
    });
    const document = dom.window.document;
    const scroll = document.querySelector("#editorScroll");

    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "o",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    }));
    await waitFor(() => document.querySelectorAll("#tabList .tab").length === 2, "second document tab");

    const tabButton = (name) => Array.from(document.querySelectorAll("#tabList [data-tab-id]"))
        .find((button) => button.textContent.includes(name));

    scroll.scrollTop = 320;
    tabButton("first.md").click();
    await waitFor(
        () => document.querySelector(".tab.is-active .tab-title").textContent.includes("first.md"),
        "first tab activation"
    );
    assert.equal(scroll.scrollTop, 0, "first tab should keep its own scroll position");

    scroll.scrollTop = 140;
    tabButton("second.md").click();
    await waitFor(
        () => document.querySelector(".tab.is-active .tab-title").textContent.includes("second.md"),
        "second tab activation"
    );
    assert.equal(scroll.scrollTop, 320, "second tab should restore its own scroll position");

    tabButton("first.md").click();
    await waitFor(
        () => document.querySelector(".tab.is-active .tab-title").textContent.includes("first.md"),
        "first tab reactivation"
    );
    assert.equal(scroll.scrollTop, 140, "scroll positions must not leak between tabs");
    dom.window.close();
});

test("closing a dirty tab asks before discarding its buffer", async () => {
    const { dom } = await bootEditor({ startup: "C:\\notes\\note.md" });
    const document = dom.window.document;
    const editor = document.querySelector("#editor");

    editor.innerHTML = "<p>keep this draft</p>";
    editor.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "w",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    }));

    await waitFor(() => document.querySelector("#modalBackdrop").hidden === false, "close prompt");
    document.querySelector("#modalActions button").click();
    await waitFor(() => document.querySelector("#modalBackdrop").hidden === true, "prompt dismissal");
    assert.equal(document.querySelectorAll("#tabList .tab").length, 1);
    assert.match(editor.textContent, /keep this draft/);
    assert.ok(document.querySelector(".tab.is-active .tab-dirty"));
    dom.window.close();
});

test("recovery drafts stay with their tabs and survive creating a new document", async () => {
    const firstPath = "C:\\notes\\first.md";
    const secondPath = "C:\\notes\\second.md";
    const { dom, calls } = await bootEditor({
        startup: firstPath,
        documents: {
            [firstPath]: { path: firstPath, name: "first.md", content: "# first", size: 7 },
            [secondPath]: { path: secondPath, name: "second.md", content: "# second", size: 8 },
        },
        openDialogs: [{ path: secondPath, name: "second.md", content: "# second", size: 8 }],
    });
    const document = dom.window.document;
    const editor = document.querySelector("#editor");
    const tabButton = (name) => Array.from(document.querySelectorAll("#tabList [data-tab-id]"))
        .find((button) => button.textContent.includes(name));
    const savesDraft = (text) => calls.some(
        ([name, , , , content]) => name === "SaveRecoveryDraft" && content.includes(text)
    );

    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "o",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    }));
    await waitFor(() => document.querySelectorAll("#tabList .tab").length === 2, "second document tab");

    editor.innerHTML = "<p>second recovery</p>";
    editor.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await waitFor(() => savesDraft("second recovery"), "second recovery draft");

    tabButton("first.md").click();
    await waitFor(
        () => document.querySelector(".tab.is-active .tab-title").textContent.includes("first.md"),
        "first tab activation"
    );
    editor.innerHTML = "<p>first recovery</p>";
    editor.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await waitFor(() => savesDraft("first recovery"), "first recovery draft");

    const recoverySaves = calls.filter(([name]) => name === "SaveRecoveryDraft");
    const relevant = recoverySaves.filter(([, , path]) => path === firstPath || path === secondPath);
    assert.equal(new Set(relevant.map(([, id]) => id)).size, 2);
    assert.ok(relevant.some(([, , path, , content]) => path === firstPath && content.includes("first recovery")));
    assert.ok(relevant.some(([, , path, , content]) => path === secondPath && content.includes("second recovery")));

    const clearCount = calls.filter(([name]) => name === "ClearRecoveryDraft" || name === "ClearRecoveryDrafts").length;
    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "n",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    }));
    await waitFor(() => document.querySelectorAll("#tabList .tab").length === 3, "new document tab");
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(
        calls.filter(([name]) => name === "ClearRecoveryDraft" || name === "ClearRecoveryDrafts").length,
        clearCount,
        "creating a document must not clear another tab's recovery draft"
    );
    dom.window.close();
});

test("reopening the active file keeps the close guard dirty", async () => {
    const path = "C:\\notes\\note.md";
    const { dom, calls, getDirty } = await bootEditor({
        startup: path,
        documents: { [path]: { path, name: "note.md", content: "# note", size: 6 } },
        openDialogs: [{ path, name: "note.md", content: "# note", size: 6 }],
    });
    const document = dom.window.document;
    const editor = document.querySelector("#editor");

    editor.innerHTML = "<p>dirty content</p>";
    editor.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await waitFor(() => getDirty(), "dirty close guard");

    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "o",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    }));
    await waitFor(() => calls.some(([name]) => name === "OpenFileDialog"), "reopen dialog");
    const openIndex = calls.map(([name]) => name).lastIndexOf("OpenPath");
    await waitFor(
        () => openIndex >= 0 && calls.slice(openIndex).some(([name, dirty]) => name === "SetDirty" && dirty === true),
        "dirty state resynchronisation"
    );
    assert.equal(document.querySelectorAll("#tabList .tab").length, 1);
    assert.ok(getDirty(), "the backend close guard must stay dirty");
    dom.window.close();
});

test("rapid tab switches keep each buffer isolated", async () => {
    const firstPath = "C:\\notes\\first.md";
    const secondPath = "C:\\notes\\second.md";
    const { dom } = await bootEditor({
        startup: firstPath,
        setActiveDelay: 30,
        documents: {
            [firstPath]: { path: firstPath, name: "first.md", content: "# first", size: 7 },
            [secondPath]: { path: secondPath, name: "second.md", content: "# second", size: 8 },
        },
        openDialogs: [{ path: secondPath, name: "second.md", content: "# second", size: 8 }],
    });
    const document = dom.window.document;
    const editor = document.querySelector("#editor");
    const tabButton = (name) => Array.from(document.querySelectorAll("#tabList [data-tab-id]"))
        .find((button) => button.textContent.includes(name));

    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "o",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    }));
    await waitFor(() => document.querySelectorAll("#tabList .tab").length === 2, "second document tab");
    await waitFor(
        () => document.querySelector(".tab.is-active .tab-title").textContent.includes("second.md"),
        "second tab activation"
    );

    editor.innerHTML = "<p>second draft</p>";
    editor.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    const firstButton = tabButton("first.md");
    const secondButton = tabButton("second.md");
    firstButton.click();
    secondButton.click();

    await waitFor(
        () => document.querySelector(".tab.is-active .tab-title").textContent.includes("second.md"),
        "rapid switch completion"
    );
    await waitFor(() => editor.textContent.includes("second draft"), "second buffer restored");
    tabButton("first.md").click();
    await waitFor(
        () => document.querySelector(".tab.is-active .tab-title").textContent.includes("first.md"),
        "first tab reactivation"
    );
    assert.match(editor.textContent, /# first/);
    assert.doesNotMatch(editor.textContent, /second draft/);
    dom.window.close();
});

test("closing a dirty background tab returns to the previously active tab", async () => {
    const firstPath = "C:\\notes\\first.md";
    const secondPath = "C:\\notes\\second.md";
    const thirdPath = "C:\\notes\\third.md";
    const { dom } = await bootEditor({
        startup: firstPath,
        documents: {
            [firstPath]: { path: firstPath, name: "first.md", content: "# first", size: 7 },
            [secondPath]: { path: secondPath, name: "second.md", content: "# second", size: 8 },
            [thirdPath]: { path: thirdPath, name: "third.md", content: "# third", size: 7 },
        },
        openDialogs: [
            { path: secondPath, name: "second.md", content: "# second", size: 8 },
            { path: thirdPath, name: "third.md", content: "# third", size: 7 },
        ],
    });
    const document = dom.window.document;
    const editor = document.querySelector("#editor");
    const tabButton = (name) => Array.from(document.querySelectorAll("#tabList [data-tab-id]"))
        .find((button) => button.textContent.includes(name));
    const openNext = () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "o",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    }));

    openNext();
    await waitFor(() => document.querySelectorAll("#tabList .tab").length === 2, "second tab");
    openNext();
    await waitFor(() => document.querySelectorAll("#tabList .tab").length === 3, "third tab");

    tabButton("second.md").click();
    await waitFor(
        () => document.querySelector(".tab.is-active .tab-title").textContent.includes("second.md"),
        "second tab activation"
    );
    editor.innerHTML = "<p>discard me</p>";
    editor.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    tabButton("first.md").click();
    await waitFor(
        () => document.querySelector(".tab.is-active .tab-title").textContent.includes("first.md"),
        "first tab activation"
    );

    const secondItem = tabButton("second.md").closest(".tab");
    secondItem.querySelector("[data-tab-close]").click();
    await waitFor(() => document.querySelector("#modalBackdrop").hidden === false, "discard prompt");
    document.querySelector("#modalActions .danger").click();
    await waitFor(() => document.querySelectorAll("#tabList .tab").length === 2, "tab closed");
    await waitFor(
        () => document.querySelector(".tab.is-active .tab-title").textContent.includes("first.md"),
        "return to previous tab"
    );
    dom.window.close();
});

test("pasting an image keeps the target tab and document directory", async () => {
    const firstPath = "C:\\notes\\first.md";
    const secondPath = "C:\\notes\\second.md";
    const { dom, calls } = await bootEditor({
        startup: firstPath,
        saveImageDelay: 80,
        documents: {
            [firstPath]: { path: firstPath, name: "first.md", content: "# first", size: 7 },
            [secondPath]: { path: secondPath, name: "second.md", content: "# second", size: 8 },
        },
        openDialogs: [{ path: secondPath, name: "second.md", content: "# second", size: 8 }],
    });
    const document = dom.window.document;
    const editor = document.querySelector("#editor");
    const tabButton = (name) => Array.from(document.querySelectorAll("#tabList [data-tab-id]"))
        .find((button) => button.textContent.includes(name));

    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "o",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    }));
    await waitFor(() => document.querySelectorAll("#tabList .tab").length === 2, "second document tab");
    await waitFor(
        () => document.querySelector(".tab.is-active .tab-title").textContent.includes("second.md"),
        "second tab activation"
    );

    const file = new dom.window.File([new Uint8Array([1, 2, 3])], "paste.png", { type: "image/png" });
    const event = new dom.window.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
        value: {
            items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
            files: [file],
            getData: () => "",
        },
    });
    editor.dispatchEvent(event);
    tabButton("first.md").click();

    await waitFor(() => calls.some(([name]) => name === "SavePastedImage"), "pasted image save");
    const imageSave = calls.find(([name]) => name === "SavePastedImage");
    assert.equal(imageSave[2], secondPath);
    await waitFor(
        () => document.querySelector(".tab.is-active .tab-title").textContent.includes("first.md"),
        "queued tab switch"
    );

    tabButton("second.md").click();
    await waitFor(
        () => document.querySelector(".tab.is-active .tab-title").textContent.includes("second.md"),
        "second tab reactivation"
    );
    assert.ok(editor.querySelector("img"));
    dom.window.close();
});

test("multiple recovery drafts restore as independent tabs", async () => {
    const now = new Date().toISOString();
    const { dom } = await bootEditor({
        recovery: [
            {
                id: "draft-a",
                path: "C:\\notes\\a.md",
                name: "a.md",
                content: "# recovered a",
                baseContent: "# a",
                savedAt: now,
            },
            {
                id: "draft-b",
                path: "C:\\notes\\b.md",
                name: "b.md",
                content: "# recovered b",
                baseContent: "# b",
                savedAt: now,
            },
        ],
    });
    const document = dom.window.document;
    await waitFor(() => document.querySelector("#modalBackdrop").hidden === false, "multi-draft prompt");
    document.querySelector("#modalActions .primary").click();
    await waitFor(() => document.querySelectorAll("#tabList .tab").length === 2, "restored draft tabs");

    const tabButton = (name) => Array.from(document.querySelectorAll("#tabList [data-tab-id]"))
        .find((button) => button.textContent.includes(name));
    tabButton("a.md").click();
    await waitFor(
        () => document.querySelector("#editor").textContent.includes("# recovered a"),
        "first recovered draft"
    );
    tabButton("b.md").click();
    await waitFor(
        () => document.querySelector("#editor").textContent.includes("# recovered b"),
        "second recovered draft"
    );
    dom.window.close();
});

test("save as excludes the active tab and reports other open paths", async () => {
    const firstPath = "C:\\notes\\first.md";
    const secondPath = "C:\\notes\\second.md";
    const { dom, calls } = await bootEditor({
        startup: firstPath,
        documents: {
            [firstPath]: { path: firstPath, name: "first.md", content: "# first", size: 7 },
            [secondPath]: { path: secondPath, name: "second.md", content: "# second", size: 8 },
        },
        openDialogs: [{ path: secondPath, name: "second.md", content: "# second", size: 8 }],
    });
    const document = dom.window.document;

    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "o",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    }));
    await waitFor(() => document.querySelectorAll("#tabList .tab").length === 2, "second document tab");
    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
    }));
    await waitFor(() => calls.some(([name]) => name === "SaveDocumentAs"), "save as call");
    const saveAs = calls.find(([name]) => name === "SaveDocumentAs");
    assert.deepEqual(Array.from(saveAs[2]), [firstPath]);
    dom.window.close();
});

test("Tab navigates table cells and appends a row after the final cell", async () => {
    const { dom } = await bootEditor({ startup: "C:\\notes\\note.md" });
    const document = dom.window.document;
    const editor = document.querySelector("#editor");
    editor.innerHTML = [
        "<table>",
        "<thead><tr><th>A</th><th>B</th></tr></thead>",
        "<tbody><tr><td>a1</td><td>b1</td></tr><tr><td>a2</td><td>b2</td></tr></tbody>",
        "</table>",
    ].join("");

    const placeCaret = (cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        range.collapse(true);
        const selection = dom.window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    };
    const pressTab = () => editor.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
    }));

    placeCaret(editor.querySelector("tbody tr:first-child td"));
    pressTab();
    await waitFor(
        () => dom.window.getSelection().toString() === "b1",
        "Tab moving to the next cell"
    );

    placeCaret(editor.querySelector("tbody tr:last-child td:last-child"));
    pressTab();
    await waitFor(
        () => editor.querySelectorAll("tbody tr").length === 3,
        "Tab appending a table row"
    );
    assert.equal(editor.querySelectorAll("tbody tr")[2].cells.length, 2);
    assert.equal(dom.window.getSelection().anchorNode, editor.querySelectorAll("tbody tr")[2].cells[0]);
    dom.window.close();
});

test("the table context toolbar inserts and deletes rows and columns", async () => {
    const { dom } = await bootEditor({ startup: "C:\\notes\\note.md" });
    const document = dom.window.document;
    const editor = document.querySelector("#editor");
    const toolbar = document.querySelector("#contextToolbar");
    editor.innerHTML = [
        "<table>",
        "<thead><tr><th>A</th><th>B</th></tr></thead>",
        "<tbody><tr><td>a1</td><td>b1</td></tr><tr><td>a2</td><td>b2</td></tr></tbody>",
        "</table>",
    ].join("");

    const firstCell = editor.querySelector("tbody tr:first-child td");
    const range = document.createRange();
    range.selectNodeContents(firstCell);
    range.collapse(true);
    const selection = dom.window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));

    await waitFor(() => toolbar.hidden === false, "table context toolbar");
    assert.equal(toolbar.querySelector('[data-context="table"]').hidden, false);

    editor.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "F10",
        altKey: true,
        bubbles: true,
        cancelable: true,
    }));
    assert.equal(document.activeElement, toolbar.querySelector('[data-table-action="row-above"]'));
    toolbar.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
    }));
    assert.equal(document.activeElement, editor);

    const action = (name) => toolbar.querySelector(`[data-table-action="${name}"]`).click();
    action("row-below");
    await waitFor(() => editor.querySelectorAll("tbody tr").length === 3, "inserted row");

    action("col-after");
    await waitFor(
        () => editor.querySelector("tbody tr").cells.length === 3,
        "inserted column"
    );

    action("row-delete");
    await waitFor(() => editor.querySelectorAll("tbody tr").length === 2, "deleted row");

    action("col-delete");
    await waitFor(
        () => editor.querySelector("thead tr").cells.length === 2,
        "deleted column"
    );

    action("table-delete");
    await waitFor(() => editor.querySelector("table") === null, "deleted table");
    dom.window.close();
});

test("image settings update alt text and dimensions in saved Markdown", async () => {
    const { dom, calls } = await bootEditor({ startup: "C:\\notes\\note.md" });
    const document = dom.window.document;
    const editor = document.querySelector("#editor");
    const toolbar = document.querySelector("#contextToolbar");
    const modal = document.querySelector("#modalBackdrop");
    editor.innerHTML = [
        "<p>before</p>",
        '<p><img data-md-src="images/pic.png" alt="旧图" src="/localfile/?p=images%2Fpic.png"></p>',
    ].join("");

    const image = editor.querySelector("img");
    image.click();

    await waitFor(() => toolbar.hidden === false, "image context toolbar");
    assert.equal(toolbar.querySelector('[data-context="image"]').hidden, false);
    toolbar.querySelector('[data-image-action="edit"]').click();

    await waitFor(() => modal.hidden === false, "image settings dialog");
    const alt = document.querySelector('#modalFields input[name="alt"]');
    const width = document.querySelector('#modalFields input[name="width"]');
    const height = document.querySelector('#modalFields input[name="height"]');
    alt.value = "新图";
    width.value = "320";
    height.value = "200";
    document.querySelector("#modalActions .primary").click();

    await waitFor(() => modal.hidden === true, "image settings dismissal");
    assert.equal(image.getAttribute("alt"), "新图");
    assert.equal(image.dataset.mdWidth, "320");
    assert.equal(image.dataset.mdHeight, "200");
    assert.equal(image.style.width, "320px");
    assert.equal(image.style.height, "200px");

    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    }));
    await waitFor(
        () => calls.some(([name]) => name === "SaveDocument"),
        "saving edited image Markdown"
    );
    const save = calls.find(([name]) => name === "SaveDocument");
    assert.match(
        save[2],
        /!\[新图\]\(images\/pic\.png "=320x200"\)/
    );
    dom.window.close();
});

test("image dimensions and captions round-trip through Markdown", async () => {
    const path = "C:\\notes\\note.md";
    const content = '![图](images/pic.png "=320x180 | 图注")';
    const { dom, calls } = await bootEditor({
        startup: path,
        documents: {
            [path]: { path, name: "note.md", content, size: content.length },
        },
        renderMarkdown() {
            return {
                html: '<p>图像</p><p><img src="/localfile/?p=images%2Fpic.png" alt="图" title="=320x180 | 图注"></p>',
                headings: [],
            };
        },
        readyText: "图像",
    });
    const document = dom.window.document;
    const editor = document.querySelector("#editor");

    await waitFor(() => editor.querySelector("img") !== null, "rendered sized image");
    const image = editor.querySelector("img");
    assert.equal(image.style.width, "320px");
    assert.equal(image.style.height, "180px");
    assert.equal(image.dataset.mdTitle, "图注");

    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    }));
    await waitFor(
        () => calls.some(([name]) => name === "SaveDocument"),
        "saving round-tripped image Markdown"
    );
    const save = calls.find(([name]) => name === "SaveDocument");
    assert.match(save[2], /!\[图\]\(images\/pic\.png "=320x180 \| 图注"\)/);
    dom.window.close();
});

test("table toolbar merges selected cells and splits them again", async () => {
    const { dom } = await bootEditor({ startup: "C:\\notes\\note.md" });
    const document = dom.window.document;
    const editor = document.querySelector("#editor");
    const toolbar = document.querySelector("#contextToolbar");
    editor.innerHTML = [
        "<table>",
        "<thead><tr><th>A</th><th>B</th></tr></thead>",
        "<tbody><tr><td>a1</td><td>b1</td></tr><tr><td>a2</td><td>b2</td></tr></tbody>",
        "</table>",
    ].join("");

    const first = editor.querySelector("tbody tr:first-child td:first-child");
    const second = editor.querySelector("tbody tr:last-child td:last-child");
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(second, 1);
    const selection = dom.window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));

    await waitFor(() => toolbar.hidden === false, "table toolbar for merge");
    const mergeButton = toolbar.querySelector('[data-table-action="merge"]');
    await waitFor(() => mergeButton.disabled === false, "merge action enabled");
    mergeButton.click();
    await waitFor(
        () => editor.querySelector("td[colspan='2'][rowspan='2']") !== null,
        "merged table cell"
    );
    const merged = editor.querySelector("td[colspan='2'][rowspan='2']");
    assert.deepEqual(
        Array.from(merged.querySelectorAll("p")).map((item) => item.textContent),
        ["a1", "b1", "a2", "b2"],
    );

    const splitButton = toolbar.querySelector('[data-table-action="split"]');
    await waitFor(() => splitButton.disabled === false, "split action enabled");
    splitButton.click();
    await waitFor(
        () => editor.querySelector("td[colspan='2'][rowspan='2']") === null,
        "split table cell"
    );
    assert.equal(editor.querySelectorAll("tbody tr")[1].cells.length, 2);
    dom.window.close();
});

test("Enter inside a table cell creates multiple paragraphs", async () => {
    const { dom, calls } = await bootEditor({ startup: "C:\\notes\\note.md" });
    const document = dom.window.document;
    const editor = document.querySelector("#editor");
    editor.innerHTML = [
        "<table>",
        "<thead><tr><th>H</th></tr></thead>",
        "<tbody><tr><td>first second</td></tr></tbody>",
        "</table>",
    ].join("");
    const cell = editor.querySelector("tbody td");
    const text = cell.firstChild;
    const range = document.createRange();
    range.setStart(text, 5);
    range.collapse(true);
    const selection = dom.window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    editor.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
    }));
    await waitFor(() => cell.querySelectorAll("p").length === 2, "split table paragraphs");
    assert.deepEqual(
        Array.from(cell.querySelectorAll("p")).map((item) => item.textContent.trim()),
        ["first", "second"],
    );

    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    }));
    await waitFor(
        () => calls.some(([name]) => name === "SaveDocument"),
        "saving multi-paragraph table Markdown"
    );
    const save = calls.find(([name]) => name === "SaveDocument");
    assert.match(save[2], /<td><p>first<\/p><p>second<\/p><\/td>/);
    dom.window.close();
});

test("HTML tables with merged cells and paragraphs round-trip", async () => {
    const path = "C:\\notes\\note.md";
    const content = "<table><thead><tr><th colspan=\"2\">合并</th></tr></thead>" +
        "<tbody><tr><td rowspan=\"2\"><p>第一段</p><p>第二段</p></td><td>B</td></tr>" +
        "<tr><td>C</td></tr></tbody></table>";
    const { dom, calls } = await bootEditor({
        startup: path,
        documents: {
            [path]: { path, name: "note.md", content, size: content.length },
        },
        renderMarkdown() {
            return { html: "<p>表格</p>" + content, headings: [] };
        },
        readyText: "表格",
    });
    const document = dom.window.document;
    const editor = document.querySelector("#editor");

    await waitFor(() => editor.querySelector("table") !== null, "rendered HTML table");
    const table = editor.querySelector("table");
    assert.equal(table.tHead.rows[0].cells[0].colSpan, 2);
    assert.equal(table.tBodies[0].rows[0].cells[0].rowSpan, 2);
    assert.equal(table.tBodies[0].rows[0].cells[0].querySelectorAll("p").length, 2);

    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    }));
    await waitFor(
        () => calls.some(([name]) => name === "SaveDocument"),
        "saving round-tripped HTML table"
    );
    const save = calls.find(([name]) => name === "SaveDocument");
    assert.match(save[2], /<th colspan="2">合并<\/th>/);
    assert.match(save[2], /<td rowspan="2"><p>第一段<\/p><p>第二段<\/p><\/td>/);
    dom.window.close();
});

test("pasting an HTML table preserves merged cells and paragraphs", async () => {
    const { dom } = await bootEditor({ startup: "C:\\notes\\note.md" });
    const document = dom.window.document;
    const editor = document.querySelector("#editor");
    editor.innerHTML = "<p>before</p>";
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = dom.window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const event = new dom.window.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
        value: {
            items: [],
            files: [],
            getData(type) {
                if (type === "text/html") {
                    return '<table><tbody><tr><td colspan="2"><p>第一段</p><p>第二段</p></td></tr></tbody></table>';
                }
                return "";
            },
        },
    });
    editor.dispatchEvent(event);

    await waitFor(
        () => editor.querySelector('td[colspan="2"]') !== null,
        "pasted merged table"
    );
    const cell = editor.querySelector('td[colspan="2"]');
    assert.equal(cell.colSpan, 2);
    assert.deepEqual(
        Array.from(cell.querySelectorAll("p")).map((item) => item.textContent),
        ["第一段", "第二段"],
    );
    dom.window.close();
});

test("document tabs can be reordered by dragging", async () => {
    const firstPath = "C:\\notes\\first.md";
    const secondPath = "C:\\notes\\second.md";
    const thirdPath = "C:\\notes\\third.md";
    const { dom } = await bootEditor({
        startup: firstPath,
        documents: {
            [firstPath]: { path: firstPath, name: "first.md", content: "# first", size: 7 },
            [secondPath]: { path: secondPath, name: "second.md", content: "# second", size: 8 },
            [thirdPath]: { path: thirdPath, name: "third.md", content: "# third", size: 7 },
        },
        openDialogs: [
            { path: secondPath, name: "second.md", content: "# second", size: 8 },
            { path: thirdPath, name: "third.md", content: "# third", size: 7 },
        ],
    });
    const document = dom.window.document;
    const editor = document.querySelector("#editor");
    const titles = () => Array.from(document.querySelectorAll("#tabList .tab-title"))
        .map((item) => item.textContent);
    const openNext = () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "o",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    }));

    openNext();
    await waitFor(() => document.querySelectorAll("#tabList .tab").length === 2, "second tab");
    openNext();
    await waitFor(() => document.querySelectorAll("#tabList .tab").length === 3, "third tab");
    assert.deepEqual(titles(), ["first.md", "second.md", "third.md"]);

    const firstTab = document.querySelector("#tabList .tab");
    const firstButton = firstTab.querySelector(".tab-main");
    const lastTab = document.querySelector("#tabList .tab:last-child");
    const dataTransfer = {
        effectAllowed: "",
        dropEffect: "",
        setData() {},
        getData() {
            return "";
        },
    };
    const dragStart = new dom.window.Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(dragStart, "dataTransfer", { value: dataTransfer });
    firstButton.dispatchEvent(dragStart);

    const dragOver = new dom.window.Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(dragOver, "dataTransfer", { value: dataTransfer });
    Object.defineProperty(dragOver, "clientX", { value: 1000 });
    lastTab.dispatchEvent(dragOver);
    lastTab.dispatchEvent(new dom.window.Event("drop", { bubbles: true, cancelable: true }));

    assert.deepEqual(titles(), ["second.md", "third.md", "first.md"]);
    assert.match(document.querySelector(".tab.is-active .tab-title").textContent, /third\.md/);
    assert.match(editor.textContent, /# third/);
    dom.window.close();
});

test("Alt+Arrow reorders the focused document tab", async () => {
    const firstPath = "C:\\notes\\first.md";
    const secondPath = "C:\\notes\\second.md";
    const thirdPath = "C:\\notes\\third.md";
    const { dom } = await bootEditor({
        startup: firstPath,
        documents: {
            [firstPath]: { path: firstPath, name: "first.md", content: "# first", size: 7 },
            [secondPath]: { path: secondPath, name: "second.md", content: "# second", size: 8 },
            [thirdPath]: { path: thirdPath, name: "third.md", content: "# third", size: 7 },
        },
        openDialogs: [
            { path: secondPath, name: "second.md", content: "# second", size: 8 },
            { path: thirdPath, name: "third.md", content: "# third", size: 7 },
        ],
    });
    const document = dom.window.document;
    const titles = () => Array.from(document.querySelectorAll("#tabList .tab-title"))
        .map((item) => item.textContent);
    const openNext = () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "o",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    }));

    openNext();
    await waitFor(() => document.querySelectorAll("#tabList .tab").length === 2, "second tab");
    openNext();
    await waitFor(() => document.querySelectorAll("#tabList .tab").length === 3, "third tab");

    const firstButton = document.querySelector("#tabList .tab-main");
    const firstId = firstButton.dataset.tabId;
    firstButton.focus();
    firstButton.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
        cancelable: true,
    }));

    await waitFor(() => titles()[0] === "second.md", "keyboard tab reorder");
    assert.deepEqual(titles(), ["second.md", "first.md", "third.md"]);
    assert.equal(document.activeElement?.dataset.tabId, firstId);
    dom.window.close();
});
