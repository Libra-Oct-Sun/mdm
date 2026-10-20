import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const tables = require("../frontend/src/editor-tables.js");

function tableWith(html) {
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    return dom.window.document.querySelector("table");
}

const baseTable = [
    "<table>",
    "<thead><tr><th>A</th><th>B</th></tr></thead>",
    "<tbody><tr><td>a1</td><td>b1</td></tr><tr><td>a2</td><td>b2</td></tr></tbody>",
    "</table>",
].join("");

function rowText(row) {
    return Array.from(row.cells).map((cell) => cell.textContent).join("|");
}

test("inserts a blank row above the caret row", () => {
    const table = tableWith(baseTable);
    const cell = table.querySelector("tbody tr:nth-child(2) td");

    const result = tables.insertRow(table, cell, "above");

    assert.equal(table.tBodies[0].rows.length, 3);
    assert.equal(rowText(table.tBodies[0].rows[0]), "a1|b1");
    assert.ok(Array.from(table.tBodies[0].rows[1].cells).every((item) => item.textContent === ""));
    assert.equal(result.row, table.tBodies[0].rows[1]);
});

test("inserts a blank row below the caret row", () => {
    const table = tableWith(baseTable);
    const cell = table.querySelector("tbody tr:first-child td");

    const result = tables.insertRow(table, cell, "below");

    assert.equal(table.tBodies[0].rows.length, 3);
    assert.equal(result.row, table.tBodies[0].rows[1]);
});

test("inserts columns on either side without losing header alignment", () => {
    const table = tableWith(baseTable);
    const cell = table.querySelector("tbody tr td:nth-child(2)");
    cell.style.textAlign = "right";

    tables.insertColumn(table, cell, "before");

    assert.deepEqual(
        Array.from(table.rows).map((row) => row.cells.length),
        [3, 3, 3],
    );
    assert.equal(table.tHead.rows[0].cells[1].textContent, "");
    assert.equal(table.tHead.rows[0].cells[2].textContent, "B");
    assert.equal(table.tBodies[0].rows[0].cells[1].style.textAlign, "right");
});

test("deletes a body row and focuses the following row", () => {
    const table = tableWith(baseTable);
    const cell = table.querySelector("tbody tr:first-child td");

    const result = tables.deleteRow(table, cell);

    assert.equal(table.tBodies[0].rows.length, 1);
    assert.equal(rowText(table.tBodies[0].rows[0]), "a2|b2");
    assert.equal(result.cell, table.tBodies[0].rows[0].cells[0]);
});

test("deleting the header promotes the first body row", () => {
    const table = tableWith(baseTable);

    const result = tables.deleteRow(table, table.querySelector("th"));

    assert.equal(table.rows.length, 2);
    assert.equal(table.tHead.rows[0].cells[0].tagName, "TH");
    assert.equal(rowText(table.tHead.rows[0]), "a1|b1");
    assert.equal(result.cell, table.tHead.rows[0].cells[0]);
});

test("deletes the caret column from every row", () => {
    const table = tableWith(baseTable);
    const cell = table.querySelector("tbody tr td:first-child");

    const result = tables.deleteColumn(table, cell);

    assert.deepEqual(
        Array.from(table.rows).map((row) => row.cells.length),
        [1, 1, 1],
    );
    assert.equal(table.tBodies[0].rows[0].cells[0].textContent, "b1");
    assert.equal(result.cell, table.tBodies[0].rows[0].cells[0]);
});

test("Tab moves to the next cell and appends a row after the final cell", () => {
    const table = tableWith(baseTable);
    const first = table.querySelector("tbody tr:first-child td");
    const last = table.querySelector("tbody tr:last-child td:last-child");

    const next = tables.moveCellFocus(table, first, 1);
    assert.equal(next.cell.textContent, "b1");
    assert.equal(next.addedRow, false);

    const appended = tables.moveCellFocus(table, last, 1);
    assert.equal(appended.addedRow, true);
    assert.equal(table.tBodies[0].rows.length, 3);
    assert.equal(appended.cell, table.tBodies[0].rows[2].cells[0]);
});

test("Shift+Tab wraps from the first cell to the final cell", () => {
    const table = tableWith(baseTable);
    const first = table.querySelector("th");

    const result = tables.moveCellFocus(table, first, -1);

    assert.equal(result.cell.textContent, "b2");
    assert.equal(result.addedRow, false);
});

test("merges a rectangular selection and combines cell paragraphs", () => {
    const table = tableWith([
        "<table>",
        "<thead><tr><th>H1</th><th>H2</th></tr></thead>",
        "<tbody><tr><td>a1</td><td>b1</td></tr><tr><td>a2</td><td>b2</td></tr></tbody>",
        "</table>",
    ].join(""));

    const result = tables.mergeCells(
        table,
        table.querySelector("tbody tr:first-child td:first-child"),
        table.querySelector("tbody tr:last-child td:last-child"),
    );

    assert.equal(result.cell.rowSpan, 2);
    assert.equal(result.cell.colSpan, 2);
    assert.deepEqual(
        Array.from(result.cell.querySelectorAll("p")).map((item) => item.textContent),
        ["a1", "b1", "a2", "b2"],
    );
    assert.equal(table.tBodies[0].rows[0].cells.length, 1);
    assert.equal(table.tBodies[0].rows[1].cells.length, 0);
});

test("splits a merged cell back into independent cells", () => {
    const table = tableWith([
        "<table>",
        "<thead><tr><th>H1</th><th>H2</th></tr></thead>",
        "<tbody><tr><td colspan=\"2\" rowspan=\"2\">merged</td></tr><tr></tr></tbody>",
        "</table>",
    ].join(""));
    const merged = table.querySelector("td");

    const result = tables.splitCell(table, merged);

    assert.equal(result.cell.rowSpan, 1);
    assert.equal(result.cell.colSpan, 1);
    assert.equal(table.tBodies[0].rows[0].cells.length, 2);
    assert.equal(table.tBodies[0].rows[1].cells.length, 2);
});

test("Tab skips cells covered by a colspan", () => {
    const table = tableWith([
        "<table><tbody>",
        '<tr><td colspan="2">A</td><td>C</td></tr>',
        "<tr><td>D</td><td>E</td><td>F</td></tr>",
        "</tbody></table>",
    ].join(""));

    const result = tables.moveCellFocus(table, table.querySelector("td"), 1);

    assert.equal(result.cell.textContent, "C");
});

test("inserting a row inside a rowspan extends the merged cell", () => {
    const table = tableWith([
        "<table><tbody>",
        '<tr><td rowspan="2">A</td><td>B</td></tr>',
        "<tr><td>C</td></tr>",
        "</tbody></table>",
    ].join(""));

    tables.insertRow(table, table.querySelector("tr:first-child td:last-child"), "below");

    assert.equal(table.rows.length, 3);
    assert.equal(table.rows[0].cells[0].rowSpan, 3);
    assert.equal(table.rows[1].cells.length, 1);
});

test("deleting a row inside a rowspan shrinks the merged cell", () => {
    const table = tableWith([
        "<table><tbody>",
        '<tr><td rowspan="2">A</td><td>B</td></tr>',
        "<tr><td>C</td></tr>",
        "</tbody></table>",
    ].join(""));

    tables.deleteRow(table, table.querySelector("tr:nth-child(2) td"));

    assert.equal(table.rows.length, 1);
    assert.equal(table.rows[0].cells[0].rowSpan, 1);
});

test("inserting a column inside a colspan extends the merged cell", () => {
    const table = tableWith([
        "<table><tbody>",
        '<tr><td colspan="2">A</td><td>C</td></tr>',
        "<tr><td>D</td><td>E</td><td>F</td></tr>",
        "</tbody></table>",
    ].join(""));

    tables.insertColumn(table, table.querySelector("td"), "after");

    assert.equal(table.rows[0].cells[0].colSpan, 3);
});

test("deleting a column inside a colspan shrinks the merged cell", () => {
    const table = tableWith([
        "<table><tbody>",
        '<tr><td colspan="2">A</td><td>C</td></tr>',
        "<tr><td>D</td><td>E</td><td>F</td></tr>",
        "</tbody></table>",
    ].join(""));

    tables.deleteColumn(table, table.rows[1].cells[1]);

    assert.equal(table.rows[0].cells[0].colSpan, 1);
    assert.equal(table.rows[1].cells.length, 2);
});
