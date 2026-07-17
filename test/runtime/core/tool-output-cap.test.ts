import { describe, expect, it } from "vitest";
import { capToolResult } from "../../../src/core/tool-output-cap";

describe("capToolResult (F12.65)", () => {
	it("passes small results through untouched, preserving structure", () => {
		const structured = { items: [1, 2, 3] };
		const capped = capToolResult(structured, 1_000);
		expect(capped.value).toBe(structured);
		expect(capped.truncated).toBe(false);
	});

	it("middle-truncates an oversized string, keeping head and tail with a narrowing hint", () => {
		const text = `HEAD${"x".repeat(5_000)}TAIL`;
		const capped = capToolResult(text, 1_000);
		expect(capped.truncated).toBe(true);
		expect(String(capped.value).startsWith("HEAD")).toBe(true);
		expect(String(capped.value).endsWith("TAIL")).toBe(true);
		expect(String(capped.value)).toContain("middle-truncated");
		expect(capped.originalChars).toBe(text.length);
	});

	it("catches oversized STRUCTURED results by stringifying, and withholds unmeasurable ones", () => {
		const big = { rows: Array.from({ length: 500 }, (_, index) => `row-${index}-${"y".repeat(50)}`) };
		expect(capToolResult(big, 1_000).truncated).toBe(true);
		// Review-found: a cyclic result previously passed through UNBOUNDED — the exact hole the cap closes.
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		const withheld = capToolResult(cyclic, 10);
		expect(withheld.truncated).toBe(true);
		expect(String(withheld.value)).toContain("withheld");
	});
});
