import { describe, expect, it } from "vitest";

import { normalizePreviewText, toPreviewText } from "../../../src/nklein-agent/nklein-preview-text";

describe("normalizePreviewText", () => {
	it("collapses whitespace runs to single spaces and trims", () => {
		expect(normalizePreviewText("  hello   world  ")).toBe("hello world");
		expect(normalizePreviewText("line1\n\tline2")).toBe("line1 line2");
	});

	it("returns null for empty / whitespace-only / non-string input", () => {
		expect(normalizePreviewText("   ")).toBeNull();
		expect(normalizePreviewText("")).toBeNull();
		expect(normalizePreviewText(null)).toBeNull();
		expect(normalizePreviewText(undefined)).toBeNull();
	});
});

describe("toPreviewText", () => {
	it("returns the normalized text unchanged when within the cap", () => {
		expect(toPreviewText("  short   text ")).toBe("short text");
		expect(toPreviewText("exactly5", 8)).toBe("exactly5"); // length 8 === maxLength, not truncated
	});

	it("caps an over-long string at maxLength with a trailing ellipsis", () => {
		const result = toPreviewText("a".repeat(200), 10);
		expect(result).toBe("aaaaaaaaa…"); // 9 a's + the single ellipsis char
		expect(result).toHaveLength(10);
	});

	it("uses 160 as the default cap", () => {
		expect(toPreviewText("a".repeat(200))).toHaveLength(160);
	});

	it("trims a trailing space before the ellipsis (so it can come in under the cap)", () => {
		// normalized "abc defghij" (len 11) > 5 → slice(0,4)="abc " → trimEnd "abc" → "abc…"
		expect(toPreviewText("abc defghij", 5)).toBe("abc…");
	});

	it("returns null for empty / normalized-empty input", () => {
		expect(toPreviewText("")).toBeNull();
		expect(toPreviewText("   ")).toBeNull();
		expect(toPreviewText(null)).toBeNull();
	});
});
