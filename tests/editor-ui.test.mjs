import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { JSDOM } from "jsdom";

const indexHTML = readFileSync(new URL("../frontend/src/index.html", import.meta.url), "utf8");
const serializerSource = readFileSync(new URL("../frontend/src/markdown-serializer.js", import.meta.url), "utf8");
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

async function bootEditor({ recovery = null, startup = "" } = {}) {
    const dom = new JSDOM(indexHTML, {
        runScripts: "outside-only",
        pretendToBeVisual: true,
        url: "https://mdmuder.test/",
    });
    const calls = [];
    const app = {
        async TakeStartupFile() {
            calls.push(["TakeStartupFile"]);
            return startup;
        },
        async OpenPath(path) {
            calls.push(["OpenPath", path]);
            return { path, name: "note.md", content: "# note", size: 6 };
        },
        async LoadRecoveryDraft() {
            calls.push(["LoadRecoveryDraft"]);
            return recovery;
        },
        async ClearRecoveryDraft() {
            calls.push(["ClearRecoveryDraft"]);
        },
        async SaveRecoveryDraft(...args) {
            calls.push(["SaveRecoveryDraft", ...args]);
        },
        async SetDirty(...args) {
            calls.push(["SetDirty", ...args]);
        },
        async RenderMarkdown(markdown) {
            calls.push(["RenderMarkdown", markdown]);
            return { html: `<pre>${escapeHTML(markdown)}</pre>`, headings: [] };
        },
        async SavePastedImage(dataURL) {
            calls.push(["SavePastedImage", dataURL]);
            return { path: "C:\\notes\\assets\\paste.png", relativePath: "assets/paste.png" };
        },
    };

    dom.window.go = { main: { App: app } };
    dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    dom.window.eval(serializerSource);
    dom.window.eval(searchSource);
    dom.window.eval(mainSource);

    await waitFor(
        () => {
            const text = dom.window.document.querySelector("#editor")?.textContent || "";
            return startup ? text.includes("# note") : text.includes("欢迎使用 Mdmuder");
        },
        "editor initialization"
    );
    return { dom, calls };
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
        () => calls.some(([name, , , content]) => name === "SaveRecoveryDraft" && content.includes("unsaved text")),
        "recovery draft write"
    );
    dom.window.close();
});
