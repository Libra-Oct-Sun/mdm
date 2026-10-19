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
                const source = node.dataset.mdSrc || node.getAttribute("src") || "";
                const alt = String(node.getAttribute("alt") || "").replace(/[[\]\\]/g, "\\$&");
                output += `![${alt}](${formatDestination(source)})`;
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
        isIgnoredNode,
        serializeEditor,
        serializeBlocks,
    };
});
