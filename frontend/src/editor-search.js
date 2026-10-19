(function (root, factory) {
    "use strict";

    const api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.MdmuderSearch = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    function findMatches(nodes, query) {
        if (!query) {
            return [];
        }
        const needle = query.toLowerCase();
        const matches = [];
        for (const node of nodes) {
            if (!node || typeof node.nodeValue !== "string") {
                continue;
            }
            const text = node.nodeValue.toLowerCase();
            let position = 0;
            while ((position = text.indexOf(needle, position)) !== -1) {
                matches.push({ node, start: position, end: position + query.length });
                position += Math.max(1, needle.length);
            }
        }
        return matches;
    }

    function replaceMatch(match, replacement) {
        if (!match || !match.node || typeof match.node.nodeValue !== "string") {
            return false;
        }
        const value = match.node.nodeValue;
        if (match.start < 0 || match.end < match.start || match.end > value.length) {
            return false;
        }
        match.node.nodeValue = value.slice(0, match.start) + replacement + value.slice(match.end);
        return true;
    }

    function replaceMatches(matches, replacement) {
        const byNode = new Map();
        for (const match of matches) {
            if (!match || !match.node || typeof match.node.nodeValue !== "string") {
                continue;
            }
            const group = byNode.get(match.node) || [];
            group.push(match);
            byNode.set(match.node, group);
        }

        let replaced = 0;
        for (const [node, group] of byNode) {
            let value = node.nodeValue;
            group.sort((a, b) => b.start - a.start);
            for (const match of group) {
                if (match.start < 0 || match.end < match.start || match.end > value.length) {
                    continue;
                }
                value = value.slice(0, match.start) + replacement + value.slice(match.end);
                replaced += 1;
            }
            node.nodeValue = value;
        }
        return replaced;
    }

    return {
        findMatches,
        replaceMatch,
        replaceMatches,
    };
});
