#!/usr/bin/env node
/**
 * Append an annotation to a `todo.md` item, addressed by ITEM ID rather than by matching its prose.
 *
 * WHY THIS EXISTS. Annotating an item by text-anchor (`replace(oldProse, newProse)`) broke three times in one
 * session on 2026-07-20. Each failure was the same shape: the anchor had since been re-wrapped by an editor or a
 * formatter, the match returned nothing, and — because the edit was chained ahead of a commit — **the code
 * shipped without its backlog record.** That is precisely the code/record drift `todo.md` exists to prevent,
 * caused by the tool used to maintain it.
 *
 * Item ids (`F3.8`, `N7d`, `P20.1b`) are stable in a way prose is not: they are the one part of a line nobody
 * re-wraps. Addressing by id removes the failure mode rather than making it less likely.
 *
 * It also FAILS LOUDLY: unknown id, ambiguous id, or an unwritable file all exit non-zero, so a chained
 * `&& git commit` does not run. The previous approach could fail after the code edit and before the commit,
 * which is the worst available ordering.
 *
 *   node scripts/todo-annotate.mjs <itemId> <<'EOF'
 *   **SHIPPED 2026-07-20:** …
 *   EOF
 *
 * Optionally `--mark x|~|?|>|' '` also sets the item's checkbox, because annotating an item and forgetting its
 * marker was the OTHER half of the same drift: the body says shipped, the marker says open, and only the marker
 * is counted.
 */

import { readFileSync, writeFileSync } from "node:fs";

const [, , itemId, ...rest] = process.argv;
if (!itemId) {
	console.error("usage: todo-annotate.mjs <itemId> [--mark x|~|?|>] < annotation-on-stdin");
	process.exit(2);
}

const markIndex = rest.indexOf("--mark");
const mark = markIndex >= 0 ? rest[markIndex + 1] : null;
if (mark !== null && !["x", "~", "?", ">", " "].includes(mark)) {
	console.error(`--mark must be one of x ~ ? > or a space; got "${mark}"`);
	process.exit(2);
}

const annotation = readFileSync(0, "utf8").replace(/\n+$/, "");
if (annotation.trim().length === 0) {
	console.error("refusing to write an empty annotation — an item recorded as changed with no detail is worse than no record");
	process.exit(2);
}

const path = "todo.md";
const lines = readFileSync(path, "utf8").split("\n");

// An item header looks like: `- [x] **N7d — …`
const headerPattern = new RegExp(`^- \\[[ x~?>]\\] \\*\\*${itemId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[ —.])`);
const matches = lines.map((line, index) => (headerPattern.test(line) ? index : -1)).filter((index) => index >= 0);

if (matches.length === 0) {
	console.error(`no todo.md item with id "${itemId}" — refusing to guess`);
	process.exit(1);
}
if (matches.length > 1) {
	console.error(`id "${itemId}" matches ${matches.length} items (lines ${matches.map((i) => i + 1).join(", ")}) — refusing to pick one`);
	process.exit(1);
}

const start = matches[0];
// The item's block runs to the next top-level list item or heading.
let end = start + 1;
while (end < lines.length && !/^- \[[ x~?>]\]/.test(lines[end]) && !/^#{1,6} /.test(lines[end])) {
	end += 1;
}

if (mark !== null) {
	lines[start] = lines[start].replace(/^- \[[ x~?>]\]/, `- [${mark}]`);
}

// Indent the annotation to the item's continuation level so the block stays one item.
const indented = annotation
	.split("\n")
	.map((line) => (line.trim().length === 0 ? "" : line.startsWith("  ") ? line : `  ${line}`))
	.join("\n");

lines.splice(end, 0, indented);
writeFileSync(path, lines.join("\n"));

console.log(`annotated ${itemId} at line ${start + 1}${mark !== null ? ` and set its marker to [${mark}]` : ""}`);
