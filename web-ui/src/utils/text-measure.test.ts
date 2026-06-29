import { describe, expect, it } from "vitest";
import { DEFAULT_TEXT_MEASURE_FONT, measureTextWidth, readElementFontShorthand } from "./text-measure";

describe("measureTextWidth", () => {
	it("returns a non-negative width (canvas measure, or string-length fallback when canvas is unavailable)", () => {
		expect(measureTextWidth("", DEFAULT_TEXT_MEASURE_FONT)).toBe(0);
		const width = measureTextWidth("hello", DEFAULT_TEXT_MEASURE_FONT);
		expect(typeof width).toBe("number");
		expect(width).toBeGreaterThan(0);
	});
});

describe("readElementFontShorthand", () => {
	it("returns the fallback font for a null element", () => {
		expect(readElementFontShorthand(null)).toBe(DEFAULT_TEXT_MEASURE_FONT);
		expect(readElementFontShorthand(null, "italic 12px serif")).toBe("italic 12px serif");
	});
	it("builds a collapsed font shorthand from a real element's computed style", () => {
		const el = document.createElement("div");
		const font = readElementFontShorthand(el);
		expect(typeof font).toBe("string");
		expect(font.length).toBeGreaterThan(0);
		expect(font).not.toMatch(/\s{2,}/); // whitespace collapsed
	});
});
