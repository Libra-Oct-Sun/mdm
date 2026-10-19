import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const search = require("../frontend/src/editor-search.js");

function paragraphWith(html) {
    const dom = new JSDOM(`<!doctype html><body><div id="root">${html}</div></body>`);
    return dom.window.document.querySelector("#root");
}

test("findMatches is case-insensitive and returns every occurrence", () => {
    const root = paragraphWith("<p>Alpha alpha ALPHA</p>");
    const nodes = Array.from(root.querySelectorAll("p"))[0].childNodes;

    const matches = search.findMatches(nodes, "alpha");

    assert.deepEqual(matches.map((match) => [match.start, match.end]), [[0, 5], [6, 11], [12, 17]]);
});

test("replaceMatch changes only the selected occurrence", () => {
    const root = paragraphWith("<p>one two one</p>");
    const node = root.querySelector("p").firstChild;
    const match = { node, start: 8, end: 11 };

    assert.equal(search.replaceMatch(match, "three"), true);
    assert.equal(node.nodeValue, "one two three");
});

test("replaceMatches handles multiple text nodes without shifting offsets", () => {
    const root = paragraphWith("<p>cat <strong>cat</strong> cat</p>");
    const paragraph = root.querySelector("p");
    const textNodes = [paragraph.firstChild, paragraph.querySelector("strong").firstChild, paragraph.lastChild];
    const matches = search.findMatches(textNodes, "cat");

    assert.equal(search.replaceMatches(matches, "dog"), 3);
    assert.equal(paragraph.textContent, "dog dog dog");
});

test("empty queries and empty match sets are no-ops", () => {
    const root = paragraphWith("<p>text</p>");
    const node = root.querySelector("p").firstChild;

    assert.deepEqual(search.findMatches([node], ""), []);
    assert.equal(search.replaceMatches([], "anything"), 0);
});
