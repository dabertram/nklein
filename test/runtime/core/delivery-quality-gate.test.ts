import { describe, expect, it } from "vitest";
import { assessDeliveryQuality, type DeliveryQualityFile } from "../../../src/core/delivery-quality-gate.js";

/** The bridge composing the ported placeholder + quality-budget scanners into one delivery hold decision. */

const src = (path: string, addedLines: string[], isTest = false): DeliveryQualityFile => ({ path, addedLines, isTest });

describe("assessDeliveryQuality", () => {
	it("holds on a stub introduced in the diff", () => {
		const result = assessDeliveryQuality([
			src("src/a.ts", [
				"export function f() {",
				"  // TODO: implement",
				"  throw new Error('not implemented');",
				"}",
			]),
			src("test/a.test.ts", ["expect(f).toBeDefined();"], true),
		]);
		expect(result.hold).toBe(true);
		expect(result.holdReasons.some((r) => r.includes("placeholder"))).toBe(true);
	});

	it("holds on a quality-budget breach (untested source)", () => {
		const many = Array.from({ length: 100 }, (_, i) => `const v${i} = ${i};`);
		const result = assessDeliveryQuality([src("src/b.ts", many)]);
		expect(result.hold).toBe(true);
		expect(result.holdReasons.some((r) => r.includes("insufficient_tests"))).toBe(true);
	});

	it("passes clean, well-tested, stub-free work", () => {
		const result = assessDeliveryQuality([
			src("src/c.ts", ["export const add = (a: number, b: number) => a + b;"]),
			src("test/c.test.ts", ["expect(add(1, 2)).toBe(3);", "expect(add(0, 0)).toBe(0);"], true),
		]);
		expect(result.hold).toBe(false);
		expect(result.holdReasons).toEqual([]);
	});

	it("respects per-sub-gate toggles", () => {
		const stubbed = [
			src("src/d.ts", ["// FIXME broken", "const x = 1;"]),
			src("test/d.test.ts", ["expect(x).toBe(1);"], true),
		];
		// Placeholder scan off → the FIXME no longer holds (and the change is otherwise within budget).
		const noPlaceholder = assessDeliveryQuality(stubbed, { placeholderScanEnabled: false });
		expect(noPlaceholder.placeholder).toBeNull();
		expect(noPlaceholder.hold).toBe(false);

		// Both off → nothing runs, never holds.
		const allOff = assessDeliveryQuality(stubbed, { placeholderScanEnabled: false, qualityBudgetEnabled: false });
		expect(allOff.placeholder).toBeNull();
		expect(allOff.quality).toBeNull();
		expect(allOff.hold).toBe(false);
	});
});
