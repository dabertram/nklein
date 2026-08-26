import { describe, expect, it } from "vitest";
import {
	handlePreviewModelAcquisition,
	resolvePreviewBudgetBytes,
} from "../../../src/trpc/runtime-api/model-acquisition-preview";

/**
 * P25.3 phase-3: the server preview handler resolves the host budget and renders the shared builder. The
 * boundary test (model-acquisition-boundary) separately proves this path imports no download capability.
 */
describe("handlePreviewModelAcquisition", () => {
	const base = {
		modelKey: "qwen/qwen3.5-9b",
		format: "mlx" as const,
		sizeBytes: null,
		publisher: null,
		allowedPublishers: [] as string[],
		paramB: null,
		weightBitsPerParam: 4,
		contextTokens: 32_768,
	};

	it("resolves the budget from declared device RAM when set", () => {
		const budget = resolvePreviewBudgetBytes("m5max:128");
		expect(budget.bytes).toBe(128 * 1024 ** 3);
		expect(budget.source).toContain("declared device RAM");
	});

	it("falls back to total physical RAM when no device RAM is declared", () => {
		const budget = resolvePreviewBudgetBytes(null);
		expect(budget.bytes).toBeGreaterThan(0);
		expect(budget.source).toContain("total physical RAM");
	});

	it("parses the parameter count from the key when the caller declares none", () => {
		// qwen3.5-9b → paramB 9 parsed from the key → a real fit verdict, not an abstain.
		const preview = handlePreviewModelAcquisition(base, { configuredDeviceRamGb: "m5max:128" });
		expect(preview.fit.known).toBe(true);
		expect(preview.format.safe).toBe(true);
	});

	it("abstains on fit when the key states no parameter count", () => {
		const preview = handlePreviewModelAcquisition(
			{ ...base, modelKey: "some/mystery-model" },
			{ configuredDeviceRamGb: "m5max:128" },
		);
		expect(preview.fit.known).toBe(false);
	});
});
