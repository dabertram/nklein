import { describe, expect, it } from "vitest";
import {
	classifyContextDepth,
	DEEP_DEPTH_MIN_TOKENS,
	fitnessDepthMismatch,
	SHALLOW_DEPTH_MAX_TOKENS,
} from "../../src/core/model-fitness-freshness";

/**
 * P22.2 — fitness measured at one context depth is only weak evidence for another. The load-bearing rule is the
 * asymmetry: an UNKNOWN measured depth (an old cell, or one from before depth tracking) is a MISMATCH for a DEEP
 * card — absent evidence of deep capability must not read as deep capability — but is fine for a shallow card.
 */

describe("classifyContextDepth", () => {
	it("bands by used context tokens", () => {
		expect(classifyContextDepth(SHALLOW_DEPTH_MAX_TOKENS - 1)).toBe("shallow");
		expect(classifyContextDepth(SHALLOW_DEPTH_MAX_TOKENS)).toBe("medium");
		expect(classifyContextDepth(DEEP_DEPTH_MIN_TOKENS)).toBe("deep");
	});

	it("treats a non-finite or negative depth as shallow, not a crash", () => {
		expect(classifyContextDepth(Number.NaN)).toBe("shallow");
		expect(classifyContextDepth(-5)).toBe("shallow");
	});
});

describe("fitnessDepthMismatch — the expensive error is shallow-applied-to-deep", () => {
	it("a DEEP card trusts ONLY a deep-measured cell; unknown or shallower is a mismatch", () => {
		expect(fitnessDepthMismatch("deep", "deep")).toBe(false);
		expect(fitnessDepthMismatch("shallow", "deep")).toBe(true);
		expect(fitnessDepthMismatch("medium", "deep")).toBe(true);
		expect(fitnessDepthMismatch(undefined, "deep")).toBe(true); // absent evidence ≠ deep capability
	});

	it("a MEDIUM card rejects only a shallow measurement", () => {
		expect(fitnessDepthMismatch("shallow", "medium")).toBe(true);
		expect(fitnessDepthMismatch("medium", "medium")).toBe(false);
		expect(fitnessDepthMismatch("deep", "medium")).toBe(false);
		expect(fitnessDepthMismatch(undefined, "medium")).toBe(false); // unknown allowed where it can't over-promise
	});

	it("a SHALLOW card is covered by any measurement, including unknown", () => {
		for (const m of ["shallow", "medium", "deep", undefined] as const) {
			expect(fitnessDepthMismatch(m, "shallow")).toBe(false);
		}
	});
});
