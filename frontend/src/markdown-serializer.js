(function (root, factory) {
    "use strict";

    const api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.MdmuderMarkdown = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const ELEMENT_NODE = 1;
    const TEXT_NODE = 3;
    const BLOCK_TAGS = new Set([
        "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6",
        "UL", "OL", "BLOCKQUOTE", "PRE", "TABLE", "HR", "SECTION", "ARTICLE",
    ]);

    function serializeEditor(container) {
        const blocks = serializeBlocks(container);
        const markdown = blocks.filter(Boolean).join("\n\n")
            .replace(/\u00a0/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .replace(/^\n+|\n+$/g, "");
        if (!markdown) {
            return "";
        }
        return `${markdown}\n`;
    }

    function serializeBlocks(container) {
        const blocks = [];
        let inline = [];
        const flushInline = () => {
            if (!inline.length) {
                return;
            }
            const text = escapeBlockStart(serializeInlineNodes(inline).trim());
            if (text) {
                blocks.push(text);
            }
            inline = [];
        };

        for (const node of container.childNodes) {
            if (node.nodeType === TEXT_NODE) {
                if (node.nodeValue) {
                    inline.push(node);
                }
                continue;
            }
            if (node.nodeType !== ELEMENT_NODE || isIgnoredNode(node)) {
                continue;
            }
            if (BLOCK_TAGS.has(node.tagName)) {
                flushInline();
                const block = serializeBlock(node);
                if (block) {
                    blocks.push(block);
                }
            } else {
                inline.push(node);
            }
        }
        flushInline();
        return blocks;
    }

    function serializeBlock(node) {
        const tag = node.tagName;
        if (/^H[1-6]$/.test(tag)) {
            const text = serializeInlineNodes(node.childNodes).trim();
            return text ? `${"#".repeat(Number(tag.slice(1)))} ${text}` : "";
        }
        if (tag === "P" || tag === "DIV" || tag === "SECTION" || tag === "ARTICLE") {
            if (hasBlockChildren(node)) {
                return serializeBlocks(node).join("\n\n");
            }
            return escapeBlockStart(serializeInlineNodes(node.childNodes).trim());
        }
        if (tag === "UL" || tag === "OL") {
            return serializeList(node, 0);
        }
        if (tag === "BLOCKQUOTE") {
            const inner = serializeBlocks(node).join("\n\n");
            if (!inner.trim()) {
                return "";
            }
            return inner.split("\n").map((line) => line ? `> ${line}` : ">").join("\n");
        }
        if (tag === "PRE") {
            return serializeCodeBlock(node);
        }
        if (tag === "TABLE") {
            return serializeTable(node);
        }
        if (tag === "HR") {
            return "---";
        }
        return escapeBlockStart(serializeInlineNodes([node]).trim());
    }

    function hasBlockChildren(node) {
        return Array.from(node.children).some((child) => BLOCK_TAGS.has(child.tagName));
    }

    function serializeList(list, depth) {
        const ordered = list.tagName === "OL";
        let number = Number.parseInt(list.getAttribute("start") || "1", 10) || 1;
        const lines = [];
        const indent = "    ".repeat(depth);
        for (const item of Array.from(list.children).filter((child) => child.tagName === "LI")) {
            const checkbox = findOwnCheckbox(item);
            const nested = Array.from(item.children).filter((child) => child.tagName === "UL" || child.tagName === "OL");
            const content = serializeListItemContent(item);
            let marker = ordered ? `${number}. ` : "- ";
            if (checkbox) {
                marker += checkbox.checked ? "[x] " : "[ ] ";
            }
            const line = `${indent}${marker}${content}`;
            const continuation = `${indent}${" ".repeat(marker.length)}`;
            lines.push(...line.split("\n").map((part, index) => index === 0 ? part : continuation + part));
            for (const childList of nested) {
                lines.push(serializeList(childList, depth + 1));
            }
            number += 1;
        }
        return lines.join("\n");
    }

    function serializeListItemContent(item) {
        const parts = [];
        for (const child of item.childNodes) {
            if (child.nodeType === TEXT_NODE) {
                if (child.nodeValue) {
                    parts.push(serializeInlineNodes([child]));
                }
                continue;
            }
            if (child.nodeType !== ELEMENT_NODE || isIgnoredNode(child)) {
                continue;
            }
            if (child.tagName === "UL" || child.tagName === "OL" || child.tagName === "INPUT") {
                continue;
            }
            if (child.tagName === "P" || child.tagName === "DIV") {
                const text = escapeBlockStart(serializeInlineNodes(child.childNodes).trim());
                if (text) {
                    parts.push(text);
                }
            } else {
                parts.push(serializeInlineNodes([child]));
            }
        }
        return escapeBlockStart(parts.join("\n").trim());
    }

    function serializeInlineNodes(nodes, options = {}) {
        let output = "";
        for (const node of nodes) {
            if (node.nodeType === TEXT_NODE) {
                output += escapeInlineText(node.nodeValue);
                continue;
            }
            if (node.nodeType !== ELEMENT_NODE || isIgnoredNode(node)) {
                continue;
            }
            const tag = node.tagName;
            if (tag === "BR") {
                output += "  \n";
            } else if (tag === "STRONG" || tag === "B") {
                output += `**${serializeInlineNodes(node.childNodes)}**`;
            } else if (tag === "EM" || tag === "I") {
                output += `*${serializeInlineNodes(node.childNodes)}*`;
            } else if (tag === "DEL" || tag === "S" || tag === "STRIKE") {
                output += `~~${serializeInlineNodes(node.childNodes)}~~`;
            } else if (tag === "CODE") {
                output += codeSpan(node.textContent || "");
            } else if (tag === "A") {
                const text = serializeInlineNodes(node.childNodes).trim();
                const href = node.getAttribute("href") || "";
                if (href && text) {
                    output += `[${text}](${formatDestination(href)})`;
                } else {
                    output += text || escapeInlineText(href);
                }
            } else if (tag === "IMG") {
                const { source, title } = imageInfo(node);
                const alt = String(node.getAttribute("alt") || "").replace(/[[\]\\]/g, "\\$&");
                const titlePart = title ? ` "${escapeTitle(title)}"` : "";
                output += `![${alt}](${formatDestination(source)}${titlePart})`;
            } else if (tag === "INPUT") {
                continue;
            } else if (tag === "SPAN") {
                let inner = serializeInlineNodes(node.childNodes, options);
                const weight = String(node.style.fontWeight || "").toLowerCase();
                const bold = weight === "bold" || Number.parseInt(weight, 10) >= 600;
                const italic = String(node.style.fontStyle || "").toLowerCase() === "italic";
                const strike = String(node.style.textDecoration || "").includes("line-through");
                if (bold && !node.parentElement?.closest("strong, b")) {
                    inner = `**${inner}**`;
                }
                if (italic && !node.parentElement?.closest("em, i")) {
                    inner = `*${inner}*`;
                }
                if (strike && !node.parentElement?.closest("del, s, strike")) {
                    inner = `~~${inner}~~`;
                }
                output += inner;
            } else {
                output += serializeInlineNodes(node.childNodes, options);
            }
        }
        return output;
    }

    function escapeInlineText(value) {
        return String(value)
            .replace(/\u00a0/g, " ")
            .replace(/\r\n?/g, "\n")
            .replace(/\\/g, "\\\\")
            .replace(/([*_`~[\]<>])/g, "\\$1")
            .replace(/\n+/g, " ");
    }

    function escapeBlockStart(value) {
        return value.split("\n").map((line) => {
            const escaped = line.replace(/^(\s*)(#{1,6}\s|>\s|[-+]\s|\d+[.)]\s)/, (match, indent, marker) => {
                if (/^\d/.test(marker)) {
                    return `${indent}${marker.replace(/([.)])/, "\\$1")}`;
                }
                return `${indent}\\${marker}`;
            });
            if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(escaped)) {
                return escaped.replace(/^(\s*)/, "$1\\");
            }
            if (/^\s*(`{3,}|~{3,})/.test(escaped)) {
                return escaped.replace(/^(\s*)/, "$1\\");
            }
            return escaped;
        }).join("\n");
    }

    function codeSpan(value) {
        const text = String(value).replace(/\n/g, " ");
        if (!text) {
            return "";
        }
        let longest = 0;
        for (const match of text.matchAll(/`+/g)) {
            longest = Math.max(longest, match[0].length);
        }
        const fence = "`".repeat(longest + 1);
        const padded = /^\s|\s$/.test(text) || text.startsWith("`") || text.endsWith("`");
        return padded ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
    }

    function formatDestination(value) {
        const destination = String(value || "").trim();
        if (!destination) {
            return "";
        }
        if (/[\s()<>]/.test(destination)) {
            return `<${destination.replace(/[<>]/g, "\\$&")}>`;
        }
        return destination;
    }

    function normalizeImageDimension(value) {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "";
    }

    function parseImageTitle(value) {
        const title = String(value || "");
        const match = title.match(/^=(\d*)x(\d*)(?:\s*\|\s*(.*))?$/);
        if (!match) {
            return { width: "", height: "", caption: title, hasSize: false };
        }
        const width = normalizeImageDimension(match[1]);
        const height = normalizeImageDimension(match[2]);
        return {
            width,
            height,
            caption: match[3] || "",
            hasSize: Boolean(width || height),
        };
    }

    function formatImageTitle(width, height, caption = "") {
        const normalizedWidth = normalizeImageDimension(width);
        const normalizedHeight = normalizeImageDimension(height);
        const text = String(caption || "").trim();
        if (!normalizedWidth && !normalizedHeight) {
            return text;
        }
        const marker = `=${normalizedWidth}x${normalizedHeight}`;
        return text ? `${marker} | ${text}` : marker;
    }

    function imageInfo(node) {
        const source = node.dataset.mdSrc || node.getAttribute("src") || "";
        let caption = node.dataset.mdTitle;
        let width = node.dataset.mdWidth;
        let height = node.dataset.mdHeight;
        if (!node.hasAttribute("data-md-title")) {
            const parsed = parseImageTitle(node.getAttribute("title") || "");
            caption = parsed.caption;
            width = width || parsed.width;
            height = height || parsed.height;
        }
        return {
            source,
            title: formatImageTitle(width, height, caption),
        };
    }

    function escapeTitle(value) {
        return String(value)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\r?\n/g, " ");
    }

    function serializeCodeBlock(pre) {
        const clone = pre.cloneNode(true);
        clone.querySelectorAll(".code-copy").forEach((node) => node.remove());
        const code = clone.querySelector("code");
        const text = (code ? code.textContent : clone.textContent)
            .replace(/\r\n?/g, "\n")
            .replace(/^\n+|\n+$/g, "");
        const className = code?.className || "";
        const language = className.match(/language-([\w-]+)/)?.[1] || pre.dataset.language || "";
        let longest = 0;
        for (const match of text.matchAll(/`{3,}/g)) {
            longest = Math.max(longest, match[0].length);
        }
        const fence = "`".repeat(Math.max(3, longest + 1));
        return `${fence}${language}\n${text}\n${fence}`;
    }

    function serializeTable(table) {
        if (needsHTMLTable(table)) {
            return serializeHTMLTable(table);
        }
        return serializeGFMTable(table);
    }

    function needsHTMLTable(table) {
        if (table.querySelector("caption, colgroup, tfoot")) {
            return true;
        }
        return Array.from(table.querySelectorAll("th, td")).some((cell) => {
            if ((cell.rowSpan || 1) > 1 || (cell.colSpan || 1) > 1) {
                return true;
            }
            if (Array.from(cell.childNodes).some((node) => {
                return node.nodeType === ELEMENT_NODE && BLOCK_TAGS.has(node.tagName);
            })) {
                return true;
            }
            return Boolean(cell.querySelector("p, div, ul, ol, blockquote, pre, table, hr, h1, h2, h3, h4, h5, h6"));
        });
    }

    function serializeGFMTable(table) {
        const rows = Array.from(table.rows);
        if (!rows.length) {
            return "";
        }
        const matrix = rows.map((row) => Array.from(row.cells).map((cell) => {
            return serializeInlineNodes(cell.childNodes)
                .trim()
                .replace(/\|/g, "\\|")
                .replace(/\n/g, "<br>");
        }));
        const width = Math.max(...matrix.map((row) => row.length));
        matrix.forEach((row) => {
            while (row.length < width) {
                row.push("");
            }
        });
        const alignments = Array.from(rows[0].cells).map((cell) => {
            const align = (cell.style.textAlign || cell.getAttribute("align") || "").toLowerCase();
            if (align === "center") {
                return ":---:";
            }
            if (align === "right") {
                return "---:";
            }
            return "---";
        });
        while (alignments.length < width) {
            alignments.push("---");
        }
        const header = matrix[0];
        const body = matrix.slice(1);
        const lines = [
            `| ${header.join(" | ")} |`,
            `| ${alignments.join(" | ")} |`,
            ...body.map((row) => `| ${row.join(" | ")} |`),
        ];
        return lines.join("\n");
    }

    function serializeHTMLTable(table) {
        const rows = Array.from(table.rows);
        if (!rows.length) {
            return "";
        }
        const headRows = table.tHead ? Array.from(table.tHead.rows) : [rows[0]];
        const bodyRows = table.tHead
            ? Array.from(table.tBodies).flatMap((body) => Array.from(body.rows))
            : rows.slice(1);
        const footRows = table.tFoot ? Array.from(table.tFoot.rows) : [];
        const caption = Array.from(table.children).find((node) => node.tagName === "CAPTION");
        const colgroup = Array.from(table.children).find((node) => node.tagName === "COLGROUP");
        let output = "<table>";
        if (caption) {
            output += `<caption>${serializeHTMLInlineNodes(caption.childNodes)}</caption>`;
        }
        if (colgroup) {
            output += serializeHTMLColgroup(colgroup);
        }
        output += `<thead>${headRows.map((row) => serializeHTMLRow(row, true)).join("")}</thead>`;
        if (bodyRows.length) {
            output += `<tbody>${bodyRows.map((row) => serializeHTMLRow(row, false)).join("")}</tbody>`;
        }
        if (footRows.length) {
            output += `<tfoot>${footRows.map((row) => serializeHTMLRow(row, false)).join("")}</tfoot>`;
        }
        return `${output}</table>`;
    }

    function serializeHTMLColgroup(colgroup) {
        const columns = Array.from(colgroup.children)
            .filter((node) => node.tagName === "COL")
            .map((column) => {
                const span = Number.parseInt(column.getAttribute("span") || "1", 10);
                const width = column.getAttribute("width") || "";
                const attributes = [];
                if (Number.isFinite(span) && span > 1) {
                    attributes.push(`span="${span}"`);
                }
                if (width) {
                    attributes.push(`width="${escapeHTMLAttribute(width)}"`);
                }
                return `<col${attributes.length ? ` ${attributes.join(" ")}` : ""}>`;
            })
            .join("");
        return columns ? `<colgroup>${columns}</colgroup>` : "";
    }

    function serializeHTMLRow(row, header = false) {
        return `<tr>${Array.from(row.cells)
            .map((cell) => serializeHTMLCell(cell, header))
            .join("")}</tr>`;
    }

    function serializeHTMLCell(cell, header = false) {
        const tag = header || cell.tagName.toLowerCase() === "th" ? "th" : "td";
        const attributes = [];
        if ((cell.colSpan || 1) > 1) {
            attributes.push(`colspan="${cell.colSpan}"`);
        }
        if ((cell.rowSpan || 1) > 1) {
            attributes.push(`rowspan="${cell.rowSpan}"`);
        }
        const align = (cell.style.textAlign || cell.getAttribute("align") || "").toLowerCase();
        if (["left", "center", "right"].includes(align)) {
            attributes.push(`align="${align}"`);
        }
        return `<${tag}${attributes.length ? ` ${attributes.join(" ")}` : ""}>` +
            `${serializeHTMLCellContent(cell)}</${tag}>`;
    }

    function serializeHTMLCellContent(cell) {
        const children = Array.from(cell.childNodes);
        const hasBlocks = children.some((node) => {
            return node.nodeType === ELEMENT_NODE && BLOCK_TAGS.has(node.tagName);
        });
        return hasBlocks
            ? serializeHTMLBlockNodes(children)
            : serializeHTMLInlineNodes(children).trim();
    }

    function serializeHTMLBlockNodes(nodes) {
        let output = "";
        let inline = [];
        const flushInline = () => {
            if (!inline.length) {
                return;
            }
            const html = serializeHTMLInlineNodes(inline).trim();
            if (html) {
                output += `<p>${html}</p>`;
            }
            inline = [];
        };
        for (const node of nodes) {
            if (node.nodeType === TEXT_NODE) {
                if (node.nodeValue.trim()) {
                    inline.push(node);
                }
                continue;
            }
            if (node.nodeType !== ELEMENT_NODE || isIgnoredNode(node)) {
                continue;
            }
            if (BLOCK_TAGS.has(node.tagName)) {
                flushInline();
                output += serializeHTMLBlock(node);
            } else {
                inline.push(node);
            }
        }
        flushInline();
        return output;
    }

    function serializeHTMLBlock(node) {
        const tag = node.tagName;
        if (/^H[1-6]$/.test(tag)) {
            return `<${tag.toLowerCase()}>${serializeHTMLInlineNodes(node.childNodes).trim()}</${tag.toLowerCase()}>`;
        }
        if (tag === "P") {
            return `<p>${serializeHTMLInlineNodes(node.childNodes).trim()}</p>`;
        }
        if (tag === "DIV" || tag === "SECTION" || tag === "ARTICLE") {
            return Array.from(node.children).some((child) => BLOCK_TAGS.has(child.tagName))
                ? serializeHTMLBlockNodes(node.childNodes)
                : `<p>${serializeHTMLInlineNodes(node.childNodes).trim()}</p>`;
        }
        if (tag === "UL" || tag === "OL") {
            return serializeHTMLList(node);
        }
        if (tag === "BLOCKQUOTE") {
            return `<blockquote>${serializeHTMLBlockNodes(node.childNodes)}</blockquote>`;
        }
        if (tag === "PRE") {
            const code = node.querySelector("code");
            const className = code?.className || "";
            const language = className.match(/language-([\w-]+)/)?.[1] || "";
            const value = (code ? code.textContent : node.textContent)
                .replace(/\r\n?/g, "\n")
                .replace(/^\n+|\n+$/g, "");
            return `<pre><code${language ? ` class="language-${language}"` : ""}>${escapeHTML(value)}</code></pre>`;
        }
        if (tag === "TABLE") {
            return serializeHTMLTable(node);
        }
        if (tag === "HR") {
            return "<hr>";
        }
        return serializeHTMLInlineNodes([node]);
    }

    function serializeHTMLList(list) {
        const tag = list.tagName.toLowerCase();
        const start = Number.parseInt(list.getAttribute("start") || "1", 10);
        const startAttribute = tag === "ol" && Number.isFinite(start) && start !== 1
            ? ` start="${start}"`
            : "";
        const items = Array.from(list.children)
            .filter((child) => child.tagName === "LI")
            .map((item) => `<li>${serializeHTMLListItem(item)}</li>`)
            .join("");
        return `<${tag}${startAttribute}>${items}</${tag}>`;
    }

    function serializeHTMLListItem(item) {
        const children = Array.from(item.childNodes);
        const hasBlocks = children.some((node) => {
            return node.nodeType === ELEMENT_NODE && BLOCK_TAGS.has(node.tagName);
        });
        return hasBlocks
            ? serializeHTMLBlockNodes(children)
            : serializeHTMLInlineNodes(children).trim();
    }

    function serializeHTMLInlineNodes(nodes) {
        let output = "";
        for (const node of nodes) {
            if (node.nodeType === TEXT_NODE) {
                output += escapeHTML(node.nodeValue).replace(/\n/g, "<br>");
                continue;
            }
            if (node.nodeType !== ELEMENT_NODE || isIgnoredNode(node)) {
                continue;
            }
            const tag = node.tagName;
            if (tag === "BR") {
                output += "<br>";
            } else if (tag === "STRONG" || tag === "B") {
                output += `<strong>${serializeHTMLInlineNodes(node.childNodes)}</strong>`;
            } else if (tag === "EM" || tag === "I") {
                output += `<em>${serializeHTMLInlineNodes(node.childNodes)}</em>`;
            } else if (tag === "DEL" || tag === "S" || tag === "STRIKE") {
                output += `<del>${serializeHTMLInlineNodes(node.childNodes)}</del>`;
            } else if (tag === "CODE") {
                output += `<code>${escapeHTML(node.textContent || "")}</code>`;
            } else if (tag === "A") {
                const href = node.getAttribute("href") || "";
                const title = node.getAttribute("title") || "";
                output += `<a href="${escapeHTMLAttribute(href)}"` +
                    `${title ? ` title="${escapeHTMLAttribute(title)}"` : ""}>` +
                    `${serializeHTMLInlineNodes(node.childNodes)}</a>`;
            } else if (tag === "IMG") {
                const { source, title } = imageInfo(node);
                output += `<img src="${escapeHTMLAttribute(source)}"` +
                    ` alt="${escapeHTMLAttribute(node.getAttribute("alt") || "")}"` +
                    `${title ? ` title="${escapeHTMLAttribute(title)}"` : ""}>`;
            } else if (tag === "INPUT") {
                if ((node.getAttribute("type") || "").toLowerCase() === "checkbox") {
                    output += `<input type="checkbox"${node.checked ? " checked" : ""}>`;
                }
            } else if (tag === "SPAN") {
                let inner = serializeHTMLInlineNodes(node.childNodes);
                const weight = String(node.style.fontWeight || "").toLowerCase();
                const bold = weight === "bold" || Number.parseInt(weight, 10) >= 600;
                const italic = String(node.style.fontStyle || "").toLowerCase() === "italic";
                const strike = String(node.style.textDecoration || "").includes("line-through");
                if (bold && !node.parentElement?.closest("strong, b")) {
                    inner = `<strong>${inner}</strong>`;
                }
                if (italic && !node.parentElement?.closest("em, i")) {
                    inner = `<em>${inner}</em>`;
                }
                if (strike && !node.parentElement?.closest("del, s, strike")) {
                    inner = `<del>${inner}</del>`;
                }
                output += inner;
            } else if (tag === "U" || tag === "MARK" || tag === "SUP" || tag === "SUB") {
                output += `<${tag.toLowerCase()}>${serializeHTMLInlineNodes(node.childNodes)}</${tag.toLowerCase()}>`;
            } else {
                output += serializeHTMLInlineNodes(node.childNodes);
            }
        }
        return output;
    }

    function escapeHTML(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function escapeHTMLAttribute(value) {
        return escapeHTML(value)
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function findOwnCheckbox(listItem) {
        for (const child of listItem.childNodes) {
            if (child.nodeType !== ELEMENT_NODE) {
                continue;
            }
            if (child.tagName === "INPUT" && child.type === "checkbox") {
                return child;
            }
            if (child.tagName === "P" || child.tagName === "DIV") {
                const nested = child.querySelector(":scope > input[type='checkbox']");
                if (nested) {
                    return nested;
                }
            }
        }
        return null;
    }

    function isIgnoredNode(node) {
        return node.nodeType === ELEMENT_NODE && (
            node.classList.contains("code-copy") ||
            node.tagName === "BUTTON"
        );
    }

    return {
        findOwnCheckbox,
        formatImageTitle,
        isIgnoredNode,
        normalizeImageDimension,
        parseImageTitle,
        serializeEditor,
        serializeBlocks,
    };
});
