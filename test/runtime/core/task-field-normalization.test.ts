import { describe, expect, it } from "vitest";

import type { RuntimeTaskImage, RuntimeTaskNKleinSettings } from "../../../src/core/api-contract";
import {
	cloneTaskImages,
	cloneTaskNKleinSettings,
	normalizeFilesLikelyTouched,
	normalizeTaskAutoReviewMode,
	normalizeTaskTestabilityFields,
} from "../../../src/core/task-field-normalization";

const settings = (partial: Record<string, unknown>) => partial as RuntimeTaskNKleinSettings;

describe("normalizeTaskAutoReviewMode", () => {
	it("keeps 'stage' (P21.13a — the lower-trust staged delivery)", () => {
		expect(normalizeTaskAutoReviewMode("stage")).toBe("stage");
	});
	it("keeps 'pr'", () => {
		expect(normalizeTaskAutoReviewMode("pr")).toBe("pr");
	});

	it("defaults anything else (incl. null/undefined) to 'commit'", () => {
		expect(normalizeTaskAutoReviewMode("commit")).toBe("commit");
		expect(normalizeTaskAutoReviewMode(null)).toBe("commit");
		expect(normalizeTaskAutoReviewMode(undefined)).toBe("commit");
	});
});

describe("normalizeTaskTestabilityFields (F1.34b-ext)", () => {
	it("returns {} for absent/invalid declarations (absence means testable-by-default, stored implicitly)", () => {
		expect(normalizeTaskTestabilityFields(undefined, undefined)).toEqual({});
		expect(normalizeTaskTestabilityFields(null, "why")).toEqual({});
	});
	it("keeps an explicit declaration and a trimmed reason only for not_testable", () => {
		expect(normalizeTaskTestabilityFields("testable", "stale reason")).toEqual({ testability: "testable" });
		expect(normalizeTaskTestabilityFields("not_testable", "  docs only  ")).toEqual({
			testability: "not_testable",
			testabilityReason: "docs only",
		});
	});
	it("drops a blank reason instead of storing empty audit text", () => {
		expect(normalizeTaskTestabilityFields("not_testable", "   ")).toEqual({ testability: "not_testable" });
		expect(normalizeTaskTestabilityFields("not_testable", undefined)).toEqual({ testability: "not_testable" });
	});
});

describe("cloneTaskImages", () => {
	it("returns undefined for missing or empty images", () => {
		expect(cloneTaskImages(undefined)).toBeUndefined();
		expect(cloneTaskImages([])).toBeUndefined();
	});

	it("deep-copies the array and each image object", () => {
		const original = [{ id: "i1" } as unknown as RuntimeTaskImage];
		const cloned = cloneTaskImages(original);
		expect(cloned).toEqual(original);
		expect(cloned).not.toBe(original);
		expect(cloned?.[0]).not.toBe(original[0]);
	});
});

describe("cloneTaskNKleinSettings", () => {
	it("returns undefined for null/undefined", () => {
		expect(cloneTaskNKleinSettings(null)).toBeUndefined();
		expect(cloneTaskNKleinSettings(undefined)).toBeUndefined();
	});

	it("trims provider/model ids and drops blank ones", () => {
		expect(cloneTaskNKleinSettings(settings({ providerId: "  lm  ", modelId: "   " }))).toEqual({
			providerId: "lm",
		});
	});

	it("keeps numeric timeout fields that are present (including 0) and drops undefined ones", () => {
		expect(
			cloneTaskNKleinSettings(settings({ requestTimeoutMs: 0, streamTimeoutMs: undefined, toolTimeoutMs: 500 })),
		).toEqual({ requestTimeoutMs: 0, toolTimeoutMs: 500 });
	});

	it("drops falsy optional enum-ish fields and returns a new object", () => {
		const input = settings({ contextScope: "", timeoutMode: "auto" });
		const cloned = cloneTaskNKleinSettings(input);
		expect(cloned).toEqual({ timeoutMode: "auto" });
		expect(cloned).not.toBe(input);
	});

	it("deep-clones the atomic card fleet-decomposition override", () => {
		const input = settings({
			fleetDecomposition: {
				mode: "smallest",
				fixedTargetModelKey: null,
				smallestBasis: "supported_floor",
				smallestSupportedModelKey: "qwen/qwen3-8b",
			},
		});
		const cloned = cloneTaskNKleinSettings(input);
		expect(cloned).toEqual(input);
		expect(cloned?.fleetDecomposition).not.toBe(input.fleetDecomposition);
	});
});

describe("normalizeFilesLikelyTouched", () => {
	it("returns undefined for missing/empty input", () => {
		expect(normalizeFilesLikelyTouched(undefined)).toBeUndefined();
		expect(normalizeFilesLikelyTouched([])).toBeUndefined();
	});

	it("trims, drops blanks, and de-duplicates", () => {
		expect(normalizeFilesLikelyTouched([" a.ts ", "a.ts", "  ", "b.ts"])).toEqual(["a.ts", "b.ts"]);
	});

	it("returns undefined when every entry is blank", () => {
		expect(normalizeFilesLikelyTouched(["  ", ""])).toBeUndefined();
	});
});
