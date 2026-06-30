import { describe, expect, it } from "vitest";

import type { RuntimeTaskImage } from "../../../src/core/api-contract";
import {
	resolveContextWindowTokens,
	resolveSdkApiTimeoutMs,
	toSdkUserImages,
} from "../../../src/nklein-agent/nklein-session-sdk-inputs";

const image = (data: string, mimeType: string): RuntimeTaskImage => ({ id: "i", data, mimeType });

describe("toSdkUserImages", () => {
	it("builds data-URL strings for valid images", () => {
		expect(toSdkUserImages([image("AAAA", "image/png"), image("BBBB", "image/jpeg")])).toEqual([
			"data:image/png;base64,AAAA",
			"data:image/jpeg;base64,BBBB",
		]);
	});

	it("returns undefined for no images", () => {
		expect(toSdkUserImages(undefined)).toBeUndefined();
		expect(toSdkUserImages([])).toBeUndefined();
	});

	it("drops entries missing data or mime type, and returns undefined if none remain", () => {
		expect(toSdkUserImages([image("AAAA", "image/png"), image("  ", "image/png")])).toEqual([
			"data:image/png;base64,AAAA",
		]);
		expect(toSdkUserImages([image("", "image/png"), image("AAAA", "  ")])).toBeUndefined();
	});
});

describe("resolveSdkApiTimeoutMs", () => {
	it("returns a truncated positive timeout", () => {
		expect(resolveSdkApiTimeoutMs(1500.9)).toBe(1500);
	});

	it("maps 0 / null / undefined / negative / non-finite to undefined (no timeout)", () => {
		for (const value of [0, null, undefined, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(resolveSdkApiTimeoutMs(value)).toBeUndefined();
		}
	});
});

describe("resolveContextWindowTokens", () => {
	it("returns a truncated positive token count", () => {
		expect(resolveContextWindowTokens(40_000.7)).toBe(40_000);
	});

	it("maps non-positive / non-finite / non-number to null", () => {
		for (const value of [0, -1, null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(resolveContextWindowTokens(value)).toBeNull();
		}
	});
});
