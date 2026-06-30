import { describe, expect, it } from "vitest";

import { meanOrNull, medianOrNull } from "../../../src/core/number-stats";

describe("meanOrNull", () => {
	it("returns null for an empty list", () => {
		expect(meanOrNull([])).toBeNull();
	});

	it("averages the values", () => {
		expect(meanOrNull([4])).toBe(4);
		expect(meanOrNull([1, 2, 3, 4])).toBe(2.5);
	});
});

describe("medianOrNull", () => {
	it("returns null for an empty list", () => {
		expect(medianOrNull([])).toBeNull();
	});

	it("returns the middle value for an odd count (order-independent)", () => {
		expect(medianOrNull([3, 1, 2])).toBe(2);
	});

	it("returns the lower of the two middles for an even count (not the average)", () => {
		expect(medianOrNull([1, 2, 3, 4])).toBe(2);
		expect(medianOrNull([4, 1, 3, 2])).toBe(2);
	});

	it("handles a single element", () => {
		expect(medianOrNull([5])).toBe(5);
	});

	it("does not mutate the input array", () => {
		const input = [3, 1, 2];
		medianOrNull(input);
		expect(input).toEqual([3, 1, 2]);
	});
});
