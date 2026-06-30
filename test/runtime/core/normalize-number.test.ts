import { describe, expect, it } from "vitest";

import { normalizePositiveNumber } from "../../../src/core/normalize-number";

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
