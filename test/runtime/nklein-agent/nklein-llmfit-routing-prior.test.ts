import { describe, expect, it, vi } from "vitest";
import type { LlmfitModel } from "../../../src/core/llmfit-adapter";
import {
	createLlmfitCapabilityPriorResolver,
	loadOptInLlmfitCapabilityPriorResolver,
} from "../../../src/nklein-agent/nklein-llmfit-routing-prior";

function model(overrides: Partial<LlmfitModel> & { name: string }): LlmfitModel {
	return {
		bestQuant: null,
		fitLevel: null,
		memoryRequiredGb: null,
		memoryAvailableGb: null,
		estimatedTps: null,
		isMoe: false,
		moeOffloadedGb: null,
		installed: false,
		contextLength: null,
		effectiveContextLength: null,
		capabilityIds: [],
		score: null,
		category: null,
		license: null,
		...overrides,
	};
}

describe("createLlmfitCapabilityPriorResolver", () => {
	it("returns undefined for an empty llmfit result", () => {
		expect(createLlmfitCapabilityPriorResolver([])).toBeUndefined();
	});

	it("matches loaded runtime names to llmfit HF names and returns the clamped routing prior", () => {
		const resolve = createLlmfitCapabilityPriorResolver([
			model({ name: "Qwen/Qwen2.5-Coder-14B-Instruct", score: 140 }),
		]);
		expect(resolve?.("qwen2.5-coder-14b@q4_k_m")).toBe(100);
		expect(resolve?.("totally-unknown")).toBeNull();
	});
});

describe("loadOptInLlmfitCapabilityPriorResolver", () => {
	it("does not load models when the env gate is disabled", async () => {
		const loadModels = vi.fn(async () => [model({ name: "Qwen/Qwen2.5-Coder-14B-Instruct", score: 88 })]);
		await expect(
			loadOptInLlmfitCapabilityPriorResolver({
				env: { NKLEIN_LLMFIT_PRIOR: "0" },
				loadModels,
			}),
		).resolves.toBeUndefined();
		expect(loadModels).not.toHaveBeenCalled();
	});

	it("loads models when the env gate is enabled and converts load failures to an absent resolver", async () => {
		const loadModels = vi.fn(async () => [model({ name: "Qwen/Qwen2.5-Coder-14B-Instruct", score: 88 })]);
		const resolve = await loadOptInLlmfitCapabilityPriorResolver({
			env: { NKLEIN_LLMFIT_PRIOR: "1" },
			loadModels,
		});
		expect(loadModels).toHaveBeenCalledTimes(1);
		expect(resolve?.("qwen/qwen2.5-coder-14b")).toBe(88);

		await expect(
			loadOptInLlmfitCapabilityPriorResolver({
				env: { NKLEIN_LLMFIT_PRIOR: "1" },
				loadModels: async () => {
					throw new Error("missing llmfit");
				},
			}),
		).resolves.toBeUndefined();
	});
});
