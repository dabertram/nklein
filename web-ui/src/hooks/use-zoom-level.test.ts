import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ZOOM_LEVEL, DETAIL_ZOOM_LEVELS, readStoredZoom, ZOOM_LEVELS } from "./use-zoom-level";

const V1 = "nklein.ui-zoom-level";
const V2 = "nklein.ui-zoom-level.v2";
const V3 = "nklein.ui-zoom-level.v3";

describe("readStoredZoom (v3 ladder — Minimalistic/Clean/Advanced/Professional/Full, David 2026-08-16)", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("defaults to Minimalistic (0) with nothing stored — easy first", () => {
		expect(DEFAULT_ZOOM_LEVEL).toBe(0);
		expect(readStoredZoom()).toBe(0);
	});

	it("reads a v3 value verbatim", () => {
		window.localStorage.setItem(V3, "3");
		expect(readStoredZoom()).toBe(3);
	});

	it("migrates every v2 value onto the v3 ladder (lean merges into Clean) and persists it", () => {
		const mapping: Array<[string, number]> = [
			["0", 0], // chat → minimalistic
			["1", 1], // overview → clean
			["2", 1], // lean → clean (the merge)
			["3", 2], // expert → advanced
			["4", 3], // professional → professional
		];
		for (const [v2, expected] of mapping) {
			window.localStorage.clear();
			window.localStorage.setItem(V2, v2);
			expect(readStoredZoom()).toBe(expected);
			expect(window.localStorage.getItem(V3)).toBe(String(expected));
		}
	});

	it("v3 beats a stale v2", () => {
		window.localStorage.setItem(V3, "4");
		window.localStorage.setItem(V2, "0");
		expect(readStoredZoom()).toBe(4);
	});

	it("migrates the ancient v1 four-level scale through the v2 shift (+1) onto v3", () => {
		// v1 0 overview → v2 1 → v3 1 Clean; v1 3 professional → v2 4 → v3 3 Professional.
		window.localStorage.setItem(V1, "0");
		expect(readStoredZoom()).toBe(1);
		window.localStorage.clear();
		window.localStorage.setItem(V1, "3");
		expect(readStoredZoom()).toBe(3);
	});

	it("garbage falls back to the default", () => {
		window.localStorage.setItem(V3, "banana");
		window.localStorage.setItem(V2, "9");
		expect(readStoredZoom()).toBe(DEFAULT_ZOOM_LEVEL);
	});

	it("the DETAIL ladder reads Minimalistic → Clean → Advanced → Professional → Full", () => {
		// Graph (level 5) joined the same bar on 2026-09-04 as a sibling VIEW, not a sixth detail level — which is
		// why `DETAIL_ZOOM_LEVELS` exists. This assertion used to read the whole bar and broke when Graph landed;
		// checking both lists is what the intent was all along, and it keeps the two from drifting apart again.
		expect(DETAIL_ZOOM_LEVELS.map((entry) => entry.label)).toEqual([
			"Minimalistic",
			"Clean",
			"Advanced",
			"Professional",
			"Full",
		]);
	});

	it("the full bar is the detail ladder plus the Graph view, in that order", () => {
		expect(ZOOM_LEVELS.map((entry) => entry.label)).toEqual([
			...DETAIL_ZOOM_LEVELS.map((entry) => entry.label),
			"Graph",
		]);
		expect(ZOOM_LEVELS.every((entry, index) => entry.level === index)).toBe(true);
	});
});
