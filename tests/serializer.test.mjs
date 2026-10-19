import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const serializer = require("../frontend/src/markdown-serializer.js");

function editorWith(html) {
    const dom = new JSDOM(`<!doctype html><body><div id="editor">${html}</div></body>`);
    return dom.window.document.querySelector("#editor");
}

test("serializes headings and inline formatting", () => {
    const editor = editorWith("<h1>标题</h1><p>Hello <strong>world</strong> and <em>kit</em>.</p>");

    assert.equal(serializer.serializeEditor(editor), "# 标题\n\nHello **world** and *kit*.\n");
});

test("escapes Markdown-sensitive text and preserves hard line breaks", () => {
    const editor = editorWith("<p>literal *stars* [x] &lt;tag&gt;</p><p>first<br>second</p>");

    assert.equal(
        serializer.serializeEditor(editor),
        "literal \\*stars\\* \\[x\\] \\<tag\\>\n\nfirst  \nsecond\n",
    );
});

test("serializes links and relative images from their Markdown source", () => {
    const editor = editorWith(
        '<p><a href="https://example.com/a b">link</a> <img data-md-src="images/a b.png" alt="图[1]"></p>',
    );

    assert.equal(
        serializer.serializeEditor(editor),
        "[link](<https://example.com/a b>) ![图\\[1\\]](<images/a b.png>)\n",
    );
});

test("serializes nested and task lists", () => {
    const editor = editorWith(
        '<ul><li><input type="checkbox" checked> 完成</li><li>Parent<ul><li>Child</li></ul></li></ul>',
    );

    assert.equal(serializer.serializeEditor(editor), "- [x] 完成\n- Parent\n    - Child\n");
});

test("keeps ordered-list numbering and starting number", () => {
    const editor = editorWith('<ol start="3"><li>three</li><li>four</li></ol>');

    assert.equal(serializer.serializeEditor(editor), "3. three\n4. four\n");
});

test("serializes fenced code blocks without copying UI controls", () => {
    const editor = editorWith(
        '<pre><code class="language-go">fmt.Println("```")</code><button class="code-copy">复制</button></pre>',
    );

    assert.equal(
        serializer.serializeEditor(editor),
        '````go\nfmt.Println("```")\n````\n',
    );
});

test("serializes table alignment and escaped cell content", () => {
    const editor = editorWith(
        '<table><thead><tr><th style="text-align:center">A</th><th>B</th></tr></thead>' +
        '<tbody><tr><td>x|y</td><td><strong>z</strong></td></tr></tbody></table>',
    );

    assert.equal(
        serializer.serializeEditor(editor),
        "| A | B |\n| :---: | --- |\n| x\\|y | **z** |\n",
    );
});

test("serializes blockquotes, horizontal rules and ignores buttons", () => {
    const editor = editorWith(
        "<blockquote><p>first</p><p>second</p></blockquote><hr><button>ignored</button>",
    );

    assert.equal(serializer.serializeEditor(editor), "> first\n>\n> second\n\n---\n");
});

test("escapes text that would otherwise start a block", () => {
    const editor = editorWith("<p>- not a list</p><p>1. not an ordered item</p>");

    assert.equal(
        serializer.serializeEditor(editor),
        "\\- not a list\n\n1\\. not an ordered item\n",
    );
});

test("returns an empty string for an empty editor", () => {
    assert.equal(serializer.serializeEditor(editorWith(" \n ")), "");
});
