import { describe, expect, it } from "vitest";
import { classifyModelClass, isModelAllowedByClassCap } from "../../../src/core/model-class-cap";

describe("classifyModelClass", () => {
	it("is cloud whenever the model is not local, regardless of capability", () => {
		expect(classifyModelClass({ isLocal: false, capabilityScore: 10 })).toBe("cloud");
		expect(classifyModelClass({ isLocal: false, capabilityScore: 95 })).toBe("cloud");
	});

	it("splits local models into small/large at the capability threshold", () => {
		expect(classifyModelClass({ isLocal: true, capabilityScore: 45 })).toBe("small");
		expect(classifyModelClass({ isLocal: true, capabilityScore: 70 })).toBe("large"); // at threshold ⇒ large
		expect(classifyModelClass({ isLocal: true, capabilityScore: 85 })).toBe("large");
		expect(classifyModelClass({ isLocal: true, capabilityScore: 85 }, { largeThreshold: 90 })).toBe("small");
	});
});

describe("isModelAllowedByClassCap", () => {
	it("permits everything when the cap is absent or `any` (the local-only policy still blocks cloud separately)", () => {
		for (const klass of ["small", "large", "cloud"] as const) {
			expect(isModelAllowedByClassCap(undefined, klass)).toBe(true);
			expect(isModelAllowedByClassCap(null, klass)).toBe(true);
			expect(isModelAllowedByClassCap("any", klass)).toBe(true);
		}
	});

	it("`any_local` excludes cloud but allows small + large local", () => {
		expect(isModelAllowedByClassCap("any_local", "small")).toBe(true);
		expect(isModelAllowedByClassCap("any_local", "large")).toBe(true);
		expect(isModelAllowedByClassCap("any_local", "cloud")).toBe(false);
	});

	it("`small_only` allows only small local models", () => {
		expect(isModelAllowedByClassCap("small_only", "small")).toBe(true);
		expect(isModelAllowedByClassCap("small_only", "large")).toBe(false);
		expect(isModelAllowedByClassCap("small_only", "cloud")).toBe(false);
	});
});
