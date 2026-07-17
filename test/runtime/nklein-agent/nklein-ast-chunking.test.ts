import { describe, expect, it } from "vitest";
import { computeAstChunkSpans } from "../../../src/nklein-agent/nklein-ast-chunking";

const fn = (name: string, bodyLines: number): string =>
	[`export function ${name}() {`, ...Array.from({ length: bodyLines }, (_, i) => `  work${i}();`), "}"].join("\n");

describe("computeAstChunkSpans (F11.2i)", () => {
	it("never splits a fitting function mid-body — the boundary lands at the next declaration", () => {
		const a = fn("alpha", 28); // 30 lines
		const b = fn("beta", 28); // 30 lines
		const content = `${a}\n${b}`;
		const spans = computeAstChunkSpans("src/x.ts", content, 40);
		expect(spans).toEqual([
			{ lineStart: 1, lineEnd: 30, enclosing: "alpha" },
			{ lineStart: 31, lineEnd: 60, enclosing: "beta" },
		]);
	});

	it("merges small declarations into one budget-sized chunk", () => {
		const content = ["const a = 1;", "const b = 2;", "function c() {", "  return 3;", "}", "const d = 4;"].join("\n");
		const spans = computeAstChunkSpans("src/y.ts", content, 40);
		expect(spans).toEqual([{ lineStart: 1, lineEnd: 6, enclosing: "a" }]);
	});

	it("splits an oversize class at member boundaries, not mid-method", () => {
		const method = (name: string): string =>
			[`  ${name}() {`, ...Array.from({ length: 18 }, (_, i) => `    step${i}();`), "  }"].join("\n");
		const content = [`export class Big {`, method("one"), method("two"), method("three"), "}"].join("\n");
		const spans = computeAstChunkSpans("src/z.ts", content, 40);
		expect(spans).not.toBeNull();
		const boundaries = (spans ?? []).map((span) => span.lineStart);
		// Every chunk boundary after the class header sits ON a method start line (2, 22, 42), never inside one.
		for (const boundary of boundaries.slice(1)) {
			expect([22, 42].includes(boundary)).toBe(true);
		}
		expect((spans ?? []).every((span) => span.enclosing === "Big")).toBe(true);
	});

	it("partitions the file exactly — no gaps, no overlap, full coverage", () => {
		const content = [fn("a", 50), fn("b", 5), "const tail = 1;", ""].join("\n");
		const totalLines = content.split("\n").length;
		const spans = computeAstChunkSpans("src/w.ts", content, 20) ?? [];
		expect(spans[0]?.lineStart).toBe(1);
		expect(spans[spans.length - 1]?.lineEnd).toBe(totalLines);
		for (let index = 1; index < spans.length; index += 1) {
			expect(spans[index]?.lineStart).toBe((spans[index - 1]?.lineEnd ?? 0) + 1);
		}
	});

	it("falls back to fixed-line pieces only inside a structureless oversize atom", () => {
		// One giant function whose body statements are the only structure; with depth exhausted the pieces are fixed.
		const spans = computeAstChunkSpans("src/big.ts", fn("huge", 100), 30) ?? [];
		expect(spans.length).toBeGreaterThan(1);
		expect(spans.every((span) => span.lineEnd - span.lineStart + 1 <= 30)).toBe(true);
	});

	it("returns null for non-TS files — the caller keeps fixed windows", () => {
		expect(computeAstChunkSpans("README.md", "# hi\n\ntext", 40)).toBeNull();
	});
});
