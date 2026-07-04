import { describe, expect, it } from "vitest";
import {
	applyModelStatsTrackingLevel,
	DEFAULT_MODEL_STATS_TRACKING_LEVEL,
	type ModelUsageStats,
	normalizeModelStatsTrackingLevel,
} from "../../../src/core/model-stats-tracking-level";

const FULL: ModelUsageStats = { promptTokens: 100, completionTokens: 40, totalTokens: 140, reasoningTokens: 12 };

describe("normalizeModelStatsTrackingLevel", () => {
	it("keeps the three valid levels", () => {
		expect(normalizeModelStatsTrackingLevel("full")).toBe("full");
		expect(normalizeModelStatsTrackingLevel("basic")).toBe("basic");
		expect(normalizeModelStatsTrackingLevel("off")).toBe("off");
	});

	it("defaults to full for unknown / non-string input", () => {
		expect(DEFAULT_MODEL_STATS_TRACKING_LEVEL).toBe("full");
		for (const bad of ["FULL", "verbose", "", null, undefined, 2, {}]) {
			expect(normalizeModelStatsTrackingLevel(bad)).toBe("full");
		}
	});
});

describe("applyModelStatsTrackingLevel", () => {
	it("full ⇒ passes every token field through", () => {
		expect(applyModelStatsTrackingLevel("full", FULL)).toEqual(FULL);
	});

	it("basic ⇒ keeps the token totals but drops the reasoning breakdown", () => {
		expect(applyModelStatsTrackingLevel("basic", FULL)).toEqual({
			promptTokens: 100,
			completionTokens: 40,
			totalTokens: 140,
			reasoningTokens: null,
		});
	});

	it("off ⇒ nulls every token field (outcome still recorded by the caller)", () => {
		expect(applyModelStatsTrackingLevel("off", FULL)).toEqual({
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			reasoningTokens: null,
		});
	});

	it("never mutates its input", () => {
		const input: ModelUsageStats = { ...FULL };
		applyModelStatsTrackingLevel("off", input);
		applyModelStatsTrackingLevel("basic", input);
		expect(input).toEqual(FULL);
	});
});
