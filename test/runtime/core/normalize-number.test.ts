import { describe, expect, it } from "vitest";

import {
	normalizeNonNegativeInteger,
	normalizePositiveInteger,
	normalizePositiveNumber,
} from "../../../src/core/normalize-number";

describe("normalizePositiveNumber", () => {
	it("keeps a finite number > 0", () => {
		expect(normalizePositiveNumber(5)).toBe(5);
		expect(normalizePositiveNumber(0.001)).toBe(0.001);
		expect(normalizePositiveNumber(5, 99)).toBe(5);
	});

	it("rejects 0, negatives, non-finite, and non-numbers → null (no fallback)", () => {
		for (const v of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "5", null, undefined, {}]) {
			expect(normalizePositiveNumber(v)).toBeNull();
		}
	});

	it("rejects 0, negatives, non-finite, and non-numbers → fallback (when given)", () => {
		for (const v of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "5", null, undefined]) {
			expect(normalizePositiveNumber(v, 42)).toBe(42);
		}
	});
});

describe("normalizePositiveInteger", () => {
	it("truncates then requires > 0", () => {
		expect(normalizePositiveInteger(5)).toBe(5);
		expect(normalizePositiveInteger(2.9)).toBe(2);
		expect(normalizePositiveInteger(3, 99)).toBe(3);
	});

	it("rejects a fraction that truncates to 0 (the corrected trunc-then-check order)", () => {
		expect(normalizePositiveInteger(0.5)).toBeNull();
		expect(normalizePositiveInteger(0.5, 7)).toBe(7);
		expect(normalizePositiveInteger(0)).toBeNull();
		expect(normalizePositiveInteger(-3)).toBeNull();
		expect(normalizePositiveInteger(Number.NaN, 7)).toBe(7);
	});
});

describe("normalizeNonNegativeInteger", () => {
	it("accepts >= 0 and truncates", () => {
		expect(normalizeNonNegativeInteger(0)).toBe(0);
		expect(normalizeNonNegativeInteger(4.9)).toBe(4);
		expect(normalizeNonNegativeInteger(0.5)).toBe(0);
		expect(normalizeNonNegativeInteger(2, 99)).toBe(2);
	});

	it("rejects a negative input BEFORE truncation (so -0.5 is rejected, not coerced to 0)", () => {
		expect(normalizeNonNegativeInteger(-0.5)).toBeNull();
		expect(normalizeNonNegativeInteger(-0.5, 7)).toBe(7);
		expect(normalizeNonNegativeInteger(-1)).toBeNull();
		expect(normalizeNonNegativeInteger(Number.NaN, 7)).toBe(7);
	});
});
