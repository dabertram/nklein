import { describe, expect, it } from "vitest";

import {
	normalizeNullableString,
	normalizePassRate,
	normalizeScore,
	normalizeScoreLikeNumber,
} from "../../../src/nklein-agent/nklein-model-registry-normalizers";

describe("normalizeScore", () => {
	it("clamps a finite number to [0, 100]", () => {
		expect(normalizeScore(42)).toBe(42);
		expect(normalizeScore(-5)).toBe(0);
		expect(normalizeScore(150)).toBe(100);
	});

	it("returns null for non-finite or non-number values", () => {
		expect(normalizeScore(Number.NaN)).toBeNull();
		expect(normalizeScore(Number.POSITIVE_INFINITY)).toBeNull();
		expect(normalizeScore("80")).toBeNull();
	});
});

describe("normalizeNullableString", () => {
	it("trims and keeps non-empty strings", () => {
		expect(normalizeNullableString("  hi  ")).toBe("hi");
	});

	it("returns null for blank or non-string values", () => {
		expect(normalizeNullableString("   ")).toBeNull();
		expect(normalizeNullableString(5)).toBeNull();
	});
});

describe("normalizeScoreLikeNumber", () => {
	it("accepts any non-negative finite number (unclamped)", () => {
		expect(normalizeScoreLikeNumber(0)).toBe(0);
		expect(normalizeScoreLikeNumber(250)).toBe(250);
	});

	it("rejects negatives, non-finite, and non-numbers", () => {
		expect(normalizeScoreLikeNumber(-1)).toBeNull();
		expect(normalizeScoreLikeNumber(Number.NaN)).toBeNull();
		expect(normalizeScoreLikeNumber("5")).toBeNull();
	});
});

describe("normalizePassRate", () => {
	it("accepts a number in [0, 1]", () => {
		expect(normalizePassRate(0)).toBe(0);
		expect(normalizePassRate(0.5)).toBe(0.5);
		expect(normalizePassRate(1)).toBe(1);
	});

	it("rejects values outside [0, 1], non-finite, and non-numbers", () => {
		expect(normalizePassRate(-0.1)).toBeNull();
		expect(normalizePassRate(1.5)).toBeNull();
		expect(normalizePassRate("0.5")).toBeNull();
	});
});
