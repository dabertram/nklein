import { describe, expect, it } from "vitest";

import type { RuntimeTaskImage, RuntimeTaskNKleinSettings } from "../../../src/core/api-contract";
import {
	cloneTaskImages,
	cloneTaskNKleinSettings,
	normalizeFilesLikelyTouched,
	normalizeTaskAutoReviewMode,
} from "../../../src/core/task-field-normalization";

const settings = (partial: Record<string, unknown>) => partial as RuntimeTaskNKleinSettings;

describe("normalizeTaskAutoReviewMode", () => {
	it("keeps 'pr'", () => {
		expect(normalizeTaskAutoReviewMode("pr")).toBe("pr");
	});

	it("defaults anything else (incl. null/undefined) to 'commit'", () => {
		expect(normalizeTaskAutoReviewMode("commit")).toBe("commit");
		expect(normalizeTaskAutoReviewMode(null)).toBe("commit");
		expect(normalizeTaskAutoReviewMode(undefined)).toBe("commit");
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
