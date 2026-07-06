import { describe, expect, it } from "vitest";
import {
	buildDisplayItems,
	buildUnifiedDiffRows,
	CONTEXT_RADIUS,
	INCREMENTAL_EXPAND_STEP,
	INCREMENTAL_EXPAND_THRESHOLD,
	MIN_COLLAPSE_LINES,
	parsePatchToRows,
	truncatePathMiddle,
	type UnifiedDiffRow,
} from "@/components/shared/diff-renderer";

function makeContextRows(count: number, startLine = 1): UnifiedDiffRow[] {
	const rows: UnifiedDiffRow[] = [];
	for (let i = 0; i < count; i += 1) {
		const lineNumber = startLine + i;
		rows.push({
			key: `c-${lineNumber}-${lineNumber}`,
			lineNumber,
			variant: "context",
			text: `line ${lineNumber}`,
		});
	}
	return rows;
}

function makeRowsWithChange(beforeCount: number, afterCount: number): UnifiedDiffRow[] {
	const rows: UnifiedDiffRow[] = [];
	let lineNumber = 1;
	for (let i = 0; i < beforeCount; i += 1) {
		rows.push({ key: `c-${lineNumber}-${lineNumber}`, lineNumber, variant: "context", text: `line ${lineNumber}` });
		lineNumber += 1;
	}
	rows.push({ key: `n-${lineNumber}`, lineNumber, variant: "added", text: `added line ${lineNumber}` });
	lineNumber += 1;
	for (let i = 0; i < afterCount; i += 1) {
		rows.push({ key: `c-${lineNumber}-${lineNumber}`, lineNumber, variant: "context", text: `line ${lineNumber}` });
		lineNumber += 1;
	}
	return rows;
}

describe("buildDisplayItems", () => {
	describe("basic collapsing behavior", () => {
		it("shows all rows when fewer than MIN_COLLAPSE_LINES context-only rows exist", () => {
			const rows = makeContextRows(MIN_COLLAPSE_LINES - 1);
			const items = buildDisplayItems(rows, {});
			expect(items.every((item) => item.type === "row")).toBe(true);
			expect(items.length).toBe(MIN_COLLAPSE_LINES - 1);
		});

		it("collapses context-only rows when count >= MIN_COLLAPSE_LINES", () => {
			const rows = makeContextRows(MIN_COLLAPSE_LINES);
			const items = buildDisplayItems(rows, {});
			expect(items.length).toBe(1);
			expect(items[0]!.type).toBe("collapsed");
			if (items[0]!.type === "collapsed") {
				expect(items[0]!.block.count).toBe(MIN_COLLAPSE_LINES);
				expect(items[0]!.block.expanded).toBe(false);
			}
		});

		it("creates collapsed blocks for distant context around a change", () => {
			const rows = makeRowsWithChange(20, 20);
			const items = buildDisplayItems(rows, {});
			const collapsedItems = items.filter((item) => item.type === "collapsed");
			expect(collapsedItems.length).toBe(2);
		});
	});

	describe("boolean expand (legacy)", () => {
		it("marks block as expanded when expandedBlocks has true for the block id", () => {
			const rows = makeContextRows(20);
			const items = buildDisplayItems(rows, {});
			expect(items.length).toBe(1);
			const blockId = items[0]!.type === "collapsed" ? items[0]!.block.id : "";
			const expandedItems = buildDisplayItems(rows, { [blockId]: true });
			expect(expandedItems.length).toBe(1);
			if (expandedItems[0]!.type === "collapsed") {
				expect(expandedItems[0]!.block.expanded).toBe(true);
				expect(expandedItems[0]!.block.rows.length).toBe(20);
			}
		});
	});

	describe("incremental expand from top", () => {
		it("reveals N lines from the top and reduces the collapsed block count", () => {
			const rows = makeContextRows(50);
			const items = buildDisplayItems(rows, {});
			const blockId = items[0]!.type === "collapsed" ? items[0]!.block.id : "";
			const result = buildDisplayItems(rows, { [blockId]: { top: 10, bottom: 0 } });
			const visibleRows = result.filter((item) => item.type === "row");
			const collapsedBlocks = result.filter((item) => item.type === "collapsed");
			expect(visibleRows.length).toBe(10);
			expect(collapsedBlocks.length).toBe(1);
			if (collapsedBlocks[0]!.type === "collapsed") {
				expect(collapsedBlocks[0]!.block.count).toBe(40);
			}
			for (let i = 0; i < 10; i += 1) {
				const item = result[i]!;
				expect(item.type).toBe("row");
				if (item.type === "row") {
					expect(item.row.lineNumber).toBe(i + 1);
				}
			}
		});
	});

	describe("incremental expand from bottom", () => {
		it("reveals N lines from the bottom and reduces the collapsed block count", () => {
			const rows = makeContextRows(50);
			const items = buildDisplayItems(rows, {});
			const blockId = items[0]!.type === "collapsed" ? items[0]!.block.id : "";
			const result = buildDisplayItems(rows, { [blockId]: { top: 0, bottom: 10 } });
			const visibleRows = result.filter((item) => item.type === "row");
			const collapsedBlocks = result.filter((item) => item.type === "collapsed");
			expect(visibleRows.length).toBe(10);
			expect(collapsedBlocks.length).toBe(1);
			if (collapsedBlocks[0]!.type === "collapsed") {
				expect(collapsedBlocks[0]!.block.count).toBe(40);
			}
			for (let i = 0; i < 10; i += 1) {
				const item = result[result.length - 10 + i]!;
				expect(item.type).toBe("row");
				if (item.type === "row") {
					expect(item.row.lineNumber).toBe(41 + i);
				}
			}
		});
	});

	describe("incremental expand from both ends", () => {
		it("reveals lines from both top and bottom simultaneously", () => {
			const rows = makeContextRows(60);
			const items = buildDisplayItems(rows, {});
			const blockId = items[0]!.type === "collapsed" ? items[0]!.block.id : "";
			const result = buildDisplayItems(rows, { [blockId]: { top: 15, bottom: 10 } });
			const visibleRows = result.filter((item) => item.type === "row");
			const collapsedBlocks = result.filter((item) => item.type === "collapsed");
			expect(visibleRows.length).toBe(25);
			expect(collapsedBlocks.length).toBe(1);
			if (collapsedBlocks[0]!.type === "collapsed") {
				expect(collapsedBlocks[0]!.block.count).toBe(35);
			}
		});

		it("fully resolves when top + bottom >= total count", () => {
			const rows = makeContextRows(30);
			const items = buildDisplayItems(rows, {});
			const blockId = items[0]!.type === "collapsed" ? items[0]!.block.id : "";
			const result = buildDisplayItems(rows, { [blockId]: { top: 20, bottom: 20 } });
			expect(result.filter((item) => item.type === "collapsed").length).toBe(0);
			expect(result.filter((item) => item.type === "row").length).toBe(30);
		});
	});

	describe("edge cases", () => {
		it("handles top reveal exceeding block count", () => {
			const rows = makeContextRows(20);
			const items = buildDisplayItems(rows, {});
			const blockId = items[0]!.type === "collapsed" ? items[0]!.block.id : "";
			const result = buildDisplayItems(rows, { [blockId]: { top: 100, bottom: 0 } });
			expect(result.filter((item) => item.type === "collapsed").length).toBe(0);
			expect(result.length).toBe(20);
		});

		it("preserves block id across incremental expansions", () => {
			const rows = makeContextRows(50);
			const items = buildDisplayItems(rows, {});
			const blockId = items[0]!.type === "collapsed" ? items[0]!.block.id : "";
			const result1 = buildDisplayItems(rows, { [blockId]: { top: 10, bottom: 0 } });
			const remainingBlock1 = result1.find((item) => item.type === "collapsed");
			expect(remainingBlock1).toBeDefined();
			if (remainingBlock1 && remainingBlock1.type === "collapsed") {
				expect(remainingBlock1.block.id).toBe(blockId);
			}
			const result2 = buildDisplayItems(rows, { [blockId]: { top: 20, bottom: 0 } });
			const remainingBlock2 = result2.find((item) => item.type === "collapsed");
			if (remainingBlock2 && remainingBlock2.type === "collapsed") {
				expect(remainingBlock2.block.id).toBe(blockId);
				expect(remainingBlock2.block.count).toBe(30);
			}
		});

		it("handles empty rows", () => {
			expect(buildDisplayItems([], {}).length).toBe(0);
		});

		it("constants have expected values", () => {
			expect(CONTEXT_RADIUS).toBe(3);
			expect(MIN_COLLAPSE_LINES).toBe(8);
			expect(INCREMENTAL_EXPAND_STEP).toBe(20);
			expect(INCREMENTAL_EXPAND_THRESHOLD).toBe(40);
		});
	});
});

describe("parsePatchToRows", () => {
	it("returns nothing for an empty patch or a patch with no hunk", () => {
		expect(parsePatchToRows("")).toEqual([]);
		expect(parsePatchToRows("diff --git a/f b/f\n--- a/f\n+++ b/f\n")).toEqual([]);
	});

	it("parses a hunk into context/removed/added rows with hunk-anchored line numbers, prefix stripped", () => {
		const patch = [
			"diff --git a/f b/f",
			"--- a/f",
			"+++ b/f",
			"@@ -1,3 +1,3 @@",
			" line1",
			"-old2",
			"+new2",
			" line3",
		].join("\n");
		const rows = parsePatchToRows(patch);
		// The `--- a/f` / `+++ b/f` headers precede the @@ hunk, so they are NOT mistaken for removed/added lines.
		expect(rows).toHaveLength(4);
		expect(rows.map((r) => ({ variant: r.variant, lineNumber: r.lineNumber, text: r.text }))).toEqual([
			{ variant: "context", lineNumber: 1, text: "line1" },
			{ variant: "removed", lineNumber: 2, text: "old2" },
			{ variant: "added", lineNumber: 2, text: "new2" },
			{ variant: "context", lineNumber: 3, text: "line3" },
		]);
	});

	it("honors the hunk header's starting line numbers", () => {
		const patch = ["@@ -10,1 +20,2 @@", "-gone", "+kept", "+extra"].join("\n");
		const rows = parsePatchToRows(patch);
		expect(rows.map((r) => [r.variant, r.lineNumber])).toEqual([
			["removed", 10],
			["added", 20],
			["added", 21],
		]);
	});
});

describe("buildUnifiedDiffRows", () => {
	it("treats a null old text as an all-added file", () => {
		const rows = buildUnifiedDiffRows(null, "a\nb");
		expect(rows.map((r) => [r.variant, r.lineNumber, r.text])).toEqual([
			["added", 1, "a"],
			["added", 2, "b"],
		]);
	});

	it("emits only context rows when old and new are identical", () => {
		const rows = buildUnifiedDiffRows("a\nb\nc", "a\nb\nc");
		expect(rows.every((r) => r.variant === "context")).toBe(true);
		expect(rows.map((r) => r.text)).toEqual(["a", "b", "c"]);
	});

	it("pairs a single changed line as removed+added with word-level inline segments", () => {
		const rows = buildUnifiedDiffRows("a\nbob\nc", "a\nbet\nc");
		const removed = rows.find((r) => r.variant === "removed");
		const added = rows.find((r) => r.variant === "added");
		expect(removed?.text).toBe("bob");
		expect(added?.text).toBe("bet");
		// the modified pair carries inline segments so the UI can highlight the changed characters
		expect(removed?.segments && removed.segments.length > 0).toBe(true);
		expect(added?.segments && added.segments.length > 0).toBe(true);
	});
});

describe("truncatePathMiddle", () => {
	it("leaves a path at or under the limit unchanged", () => {
		expect(truncatePathMiddle("src/a/b.ts", 64)).toBe("src/a/b.ts");
	});

	it("elides the middle with `...`, keeping head + tail, for a long path", () => {
		const path = `src/${"x".repeat(80)}/file.ts`;
		const result = truncatePathMiddle(path, 64);
		expect(result).toHaveLength(64);
		expect(result).toContain("...");
		expect(result.startsWith("src/")).toBe(true);
		expect(result.endsWith("file.ts")).toBe(true);
	});

	it("keeps at least 8 chars even when maxLength is tiny (the floor can exceed maxLength)", () => {
		// keep = max(8, 5-3) = 8 → head 4 + '...' + tail 4 = 11 chars
		expect(truncatePathMiddle("abcdefghijklmnop", 5)).toBe("abcd...mnop");
	});
});
