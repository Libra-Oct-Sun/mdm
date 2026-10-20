(function (root, factory) {
    "use strict";

    const api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.MdmuderTables = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const BLOCK_TAGS = new Set([
        "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6",
        "UL", "OL", "BLOCKQUOTE", "PRE", "TABLE", "HR", "SECTION", "ARTICLE",
    ]);

    function tableRows(table) {
        return Array.from(table.rows || []);
    }

    function rowCells(row) {
        return Array.from(row.cells || []);
    }

    function firstCell(row) {
        return rowCells(row)[0] || null;
    }

    function clamp(value, minimum, maximum) {
        return Math.min(Math.max(value, minimum), maximum);
    }

    function spanValue(value) {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1000) : 1;
    }

    function cellAlignment(cell) {
        const align = (cell.style?.textAlign || cell.getAttribute("align") || "").toLowerCase();
        return ["left", "center", "right"].includes(align) ? align : "";
    }

    function rebuildGrid(model) {
        const grid = Array.from({ length: model.rowCount }, () => []);
        for (const anchor of model.anchors) {
            anchor.row = clamp(anchor.row, 0, Math.max(0, model.rowCount - 1));
            anchor.col = clamp(anchor.col, 0, Math.max(0, model.colCount - 1));
            anchor.rowSpan = clamp(anchor.rowSpan, 1, Math.max(1, model.rowCount - anchor.row));
            anchor.colSpan = clamp(anchor.colSpan, 1, Math.max(1, model.colCount - anchor.col));
            for (let row = anchor.row; row < anchor.row + anchor.rowSpan; row += 1) {
                for (let col = anchor.col; col < anchor.col + anchor.colSpan; col += 1) {
                    if (!grid[row][col]) {
                        grid[row][col] = { anchor, row: anchor.row, col: anchor.col };
                    }
                }
            }
        }
        model.grid = grid;
        model.colCount = Math.max(
            model.colCount,
            ...grid.map((row) => row.length),
        );
    }

    function fillHoles(model) {
        const document = model.table.ownerDocument;
        for (let row = 0; row < model.rowCount; row += 1) {
            for (let col = 0; col < model.colCount; col += 1) {
                if (model.grid[row][col]) {
                    continue;
                }
                const element = document.createElement(row === 0 ? "th" : "td");
                const anchor = {
                    element,
                    row,
                    col,
                    rowSpan: 1,
                    colSpan: 1,
                    align: "",
                    isNew: true,
                };
                model.anchors.push(anchor);
                model.grid[row][col] = { anchor, row, col };
            }
        }
    }

    function createModel(table) {
        const rows = tableRows(table);
        if (!rows.length) {
            return null;
        }
        const anchors = [];
        const occupancy = [];
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            if (!occupancy[rowIndex]) {
                occupancy[rowIndex] = [];
            }
            let col = 0;
            for (const cell of rowCells(rows[rowIndex])) {
                while (occupancy[rowIndex][col]) {
                    col += 1;
                }
                const rowSpan = clamp(spanValue(cell.getAttribute("rowspan") || cell.rowSpan), 1, rows.length - rowIndex);
                const colSpan = spanValue(cell.getAttribute("colspan") || cell.colSpan);
                const anchor = {
                    element: cell,
                    row: rowIndex,
                    col,
                    rowSpan,
                    colSpan,
                    align: cellAlignment(cell),
                };
                anchors.push(anchor);
                for (let row = rowIndex; row < rowIndex + rowSpan; row += 1) {
                    if (!occupancy[row]) {
                        occupancy[row] = [];
                    }
                    for (let column = col; column < col + colSpan; column += 1) {
                        occupancy[row][column] = true;
                    }
                }
                col += colSpan;
            }
        }
        const rowCount = Math.max(
            rows.length,
            ...anchors.map((anchor) => anchor.row + anchor.rowSpan),
        );
        const colCount = Math.max(
            1,
            ...occupancy.map((row) => row.length),
        );
        const model = { table, anchors, rowCount, colCount, grid: [] };
        rebuildGrid(model);
        fillHoles(model);
        return model;
    }

    function writeTable(model) {
        const table = model.table;
        const document = table.ownerDocument;
        const caption = table.querySelector(":scope > caption");
        const colgroup = table.querySelector(":scope > colgroup");
        const foot = table.querySelector(":scope > tfoot");
        const head = document.createElement("thead");
        const body = document.createElement("tbody");
        const cells = new Map();
        const written = new Set();

        for (let rowIndex = 0; rowIndex < model.rowCount; rowIndex += 1) {
            const row = document.createElement("tr");
            for (let col = 0; col < model.colCount; col += 1) {
                const slot = model.grid[rowIndex]?.[col];
                if (!slot) {
                    continue;
                }
                const anchor = slot.anchor;
                if (anchor.row !== rowIndex || anchor.col !== col || written.has(anchor)) {
                    continue;
                }
                written.add(anchor);
                const cell = document.createElement(rowIndex === 0 ? "th" : "td");
                while (anchor.element.firstChild) {
                    cell.append(anchor.element.firstChild);
                }
                if (anchor.rowSpan > 1) {
                    cell.rowSpan = anchor.rowSpan;
                }
                if (anchor.colSpan > 1) {
                    cell.colSpan = anchor.colSpan;
                }
                if (anchor.align) {
                    cell.setAttribute("align", anchor.align);
                    cell.style.textAlign = anchor.align;
                }
                cells.set(anchor, cell);
                row.append(cell);
            }
            (rowIndex === 0 ? head : body).append(row);
        }

        table.replaceChildren(...[caption, colgroup, head, body, foot].filter(Boolean));
        return cells;
    }

    function anchorForCell(model, cell) {
        return model.anchors.find((anchor) => anchor.element === cell) || null;
    }

    function anchorAt(model, row, col) {
        return model.grid[row]?.[col]?.anchor || null;
    }

    function orderedAnchors(model) {
        const anchors = new Set();
        for (const row of model.grid) {
            for (const slot of row) {
                if (slot?.anchor) {
                    anchors.add(slot.anchor);
                }
            }
        }
        return Array.from(anchors).sort((left, right) => {
            return left.row - right.row || left.col - right.col;
        });
    }

    function normalizeCellContent(cell) {
        const document = cell.ownerDocument;
        const blocks = [];
        let inline = [];
        const flushInline = () => {
            if (!inline.length) {
                return;
            }
            const paragraph = document.createElement("p");
            for (const node of inline) {
                paragraph.append(node);
            }
            if (paragraph.textContent?.trim() || paragraph.querySelector("img, br, input")) {
                blocks.push(paragraph);
            }
            inline = [];
        };

        for (const node of Array.from(cell.childNodes)) {
            if (node.nodeType === 1 && BLOCK_TAGS.has(node.tagName)) {
                flushInline();
                blocks.push(node);
            } else if (node.nodeType === 3 && !node.nodeValue.trim()) {
                continue;
            } else {
                inline.push(node);
            }
        }
        flushInline();

        if (!blocks.length) {
            return [];
        }
        cell.replaceChildren(...blocks);
        return blocks;
    }

    function insertRowAt(model, insertAt, focusCol) {
        const original = model.anchors.map((anchor) => ({
            anchor,
            row: anchor.row,
            rowSpan: anchor.rowSpan,
        }));
        for (const { anchor, row, rowSpan } of original) {
            if (row >= insertAt) {
                anchor.row = row + 1;
            } else if (row + rowSpan > insertAt) {
                anchor.rowSpan = rowSpan + 1;
            }
        }
        model.rowCount += 1;
        rebuildGrid(model);
        fillHoles(model);
        const target = anchorAt(model, insertAt, clamp(focusCol, 0, model.colCount - 1))
            || anchorAt(model, insertAt, 0);
        const cells = writeTable(model);
        const cell = target ? cells.get(target) || null : null;
        return { cell, row: cell?.parentElement || null, addedRow: true };
    }

    function insertColumnAt(model, insertAt, focusRow) {
        const referenceRow = model.grid[clamp(focusRow, 0, model.rowCount - 1)] || [];
        const reference = referenceRow[clamp(insertAt, 0, model.colCount - 1)]?.anchor;
        const inheritedAlign = reference?.align || "";
        const original = model.anchors.map((anchor) => ({
            anchor,
            col: anchor.col,
            colSpan: anchor.colSpan,
        }));
        for (const { anchor, col, colSpan } of original) {
            if (col >= insertAt) {
                anchor.col = col + 1;
            } else if (col + colSpan > insertAt) {
                anchor.colSpan = colSpan + 1;
            }
        }
        model.colCount += 1;
        rebuildGrid(model);
        fillHoles(model);
        if (inheritedAlign) {
            for (let row = 0; row < model.rowCount; row += 1) {
                const anchor = anchorAt(model, row, insertAt);
                if (anchor?.isNew) {
                    anchor.align = inheritedAlign;
                }
            }
        }
        const target = anchorAt(model, clamp(focusRow, 0, model.rowCount - 1), insertAt)
            || anchorAt(model, 0, insertAt);
        const cells = writeTable(model);
        return { cell: target ? cells.get(target) || null : null };
    }

    function insertRow(table, referenceCell, position) {
        const model = createModel(table);
        const reference = model && anchorForCell(model, referenceCell);
        if (!reference) {
            return null;
        }
        const after = position === "after" || position === "below";
        const insertAt = reference.row === 0
            ? 1
            : reference.row + (after ? 1 : 0);
        return insertRowAt(model, insertAt, reference.col);
    }

    function insertColumn(table, referenceCell, position) {
        const model = createModel(table);
        const reference = model && anchorForCell(model, referenceCell);
        if (!reference) {
            return null;
        }
        const after = position === "after" || position === "right";
        const insertAt = reference.col + (after ? 1 : 0);
        return insertColumnAt(model, insertAt, reference.row);
    }

    function deleteRow(table, referenceCell) {
        const model = createModel(table);
        const reference = model && anchorForCell(model, referenceCell);
        if (!reference) {
            return null;
        }
        if (model.rowCount <= 1) {
            table.remove();
            return { tableRemoved: true, cell: null };
        }

        const deleteAt = reference.row;
        const removed = new Set();
        for (const anchor of model.anchors) {
            if (anchor.row === deleteAt) {
                if (anchor.rowSpan > 1) {
                    anchor.row = deleteAt + 1;
                    anchor.rowSpan -= 1;
                } else {
                    removed.add(anchor);
                }
            } else if (anchor.row < deleteAt && anchor.row + anchor.rowSpan > deleteAt) {
                anchor.rowSpan -= 1;
            } else if (anchor.row > deleteAt) {
                anchor.row -= 1;
            }
        }
        model.anchors = model.anchors.filter((anchor) => !removed.has(anchor));
        model.rowCount -= 1;
        rebuildGrid(model);
        fillHoles(model);
        const focusAnchor = anchorAt(model, Math.min(deleteAt, model.rowCount - 1), reference.col)
            || anchorAt(model, 0, 0);
        const cells = writeTable(model);
        return { cell: focusAnchor ? cells.get(focusAnchor) || null : null };
    }

    function deleteColumn(table, referenceCell) {
        const model = createModel(table);
        const reference = model && anchorForCell(model, referenceCell);
        if (!reference) {
            return null;
        }
        if (model.colCount <= 1) {
            table.remove();
            return { tableRemoved: true, cell: null };
        }

        const deleteAt = reference.col;
        const removed = new Set();
        for (const anchor of model.anchors) {
            if (anchor.col === deleteAt) {
                if (anchor.colSpan > 1) {
                    anchor.colSpan -= 1;
                } else {
                    removed.add(anchor);
                }
            } else if (anchor.col < deleteAt && anchor.col + anchor.colSpan > deleteAt) {
                anchor.colSpan -= 1;
            } else if (anchor.col > deleteAt) {
                anchor.col -= 1;
            }
        }
        model.anchors = model.anchors.filter((anchor) => !removed.has(anchor));
        model.colCount -= 1;
        rebuildGrid(model);
        fillHoles(model);
        const focusAnchor = anchorAt(model, reference.row, Math.min(deleteAt, model.colCount - 1))
            || anchorAt(model, 0, 0);
        const cells = writeTable(model);
        return { cell: focusAnchor ? cells.get(focusAnchor) || null : null };
    }

    function moveCellFocus(table, referenceCell, delta) {
        const model = createModel(table);
        const reference = model && anchorForCell(model, referenceCell);
        if (!reference) {
            return null;
        }
        const anchors = orderedAnchors(model);
        const index = anchors.indexOf(reference);
        const nextIndex = index + delta;
        if (nextIndex >= anchors.length) {
            return insertRowAt(model, model.rowCount, 0);
        }
        const target = nextIndex < 0 ? anchors[anchors.length - 1] : anchors[nextIndex];
        if (!target) {
            return null;
        }
        if (target === reference) {
            return { cell: reference.element, addedRow: false };
        }
        return { cell: target.element, addedRow: false };
    }

    function mergeCells(table, startCell, endCell) {
        const model = createModel(table);
        const start = model && anchorForCell(model, startCell);
        const end = model && anchorForCell(model, endCell);
        if (!start || !end || start === end) {
            return null;
        }

        const rect = {
            top: Math.min(start.row, end.row),
            left: Math.min(start.col, end.col),
            bottom: Math.max(start.row + start.rowSpan - 1, end.row + end.rowSpan - 1),
            right: Math.max(start.col + start.colSpan - 1, end.col + end.colSpan - 1),
        };
        let changed = true;
        while (changed) {
            changed = false;
            for (const anchor of model.anchors) {
                const bottom = anchor.row + anchor.rowSpan - 1;
                const right = anchor.col + anchor.colSpan - 1;
                if (anchor.row > rect.bottom || bottom < rect.top || anchor.col > rect.right || right < rect.left) {
                    continue;
                }
                if (anchor.row < rect.top) {
                    rect.top = anchor.row;
                    changed = true;
                }
                if (anchor.col < rect.left) {
                    rect.left = anchor.col;
                    changed = true;
                }
                if (bottom > rect.bottom) {
                    rect.bottom = bottom;
                    changed = true;
                }
                if (right > rect.right) {
                    rect.right = right;
                    changed = true;
                }
            }
        }

        const selected = model.anchors
            .filter((anchor) => {
                return anchor.row >= rect.top
                    && anchor.col >= rect.left
                    && anchor.row + anchor.rowSpan - 1 <= rect.bottom
                    && anchor.col + anchor.colSpan - 1 <= rect.right;
            })
            .sort((left, right) => left.row - right.row || left.col - right.col);
        const target = selected.find((anchor) => anchor.row === rect.top && anchor.col === rect.left);
        if (!target || selected.length <= 1) {
            return null;
        }

        const blocks = [];
        for (const anchor of selected) {
            blocks.push(...normalizeCellContent(anchor.element));
        }
        target.element.replaceChildren(...blocks);
        target.rowSpan = rect.bottom - rect.top + 1;
        target.colSpan = rect.right - rect.left + 1;
        const selectedSet = new Set(selected);
        model.anchors = model.anchors.filter((anchor) => anchor === target || !selectedSet.has(anchor));
        rebuildGrid(model);
        fillHoles(model);
        const cells = writeTable(model);
        return { cell: cells.get(target) || null };
    }

    function splitCell(table, referenceCell) {
        const model = createModel(table);
        const anchor = model && anchorForCell(model, referenceCell);
        if (!anchor || (anchor.rowSpan <= 1 && anchor.colSpan <= 1)) {
            return null;
        }
        const { row, col, rowSpan, colSpan, align } = anchor;
        anchor.rowSpan = 1;
        anchor.colSpan = 1;
        for (let targetRow = row; targetRow < row + rowSpan; targetRow += 1) {
            for (let targetCol = col; targetCol < col + colSpan; targetCol += 1) {
                if (targetRow === row && targetCol === col) {
                    continue;
                }
                const element = model.table.ownerDocument.createElement(targetRow === 0 ? "th" : "td");
                model.anchors.push({
                    element,
                    row: targetRow,
                    col: targetCol,
                    rowSpan: 1,
                    colSpan: 1,
                    align,
                    isNew: true,
                });
            }
        }
        rebuildGrid(model);
        fillHoles(model);
        const cells = writeTable(model);
        return { cell: cells.get(anchor) || null };
    }

    return {
        deleteColumn,
        deleteRow,
        insertColumn,
        insertRow,
        mergeCells,
        moveCellFocus,
        splitCell,
    };
});
