import { describe, expect, it } from "vitest";
import type { LlmfitModel } from "../../../src/core/llmfit-adapter";
import {
	findLlmfitMatch,
	llmfitCapabilityPrior,
	normalizeModelNameForMatch,
} from "../../../src/core/llmfit-capability-prior";

function m(name: string, score: number | null, category: string | null): LlmfitModel {
	return {
		name,
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
		score,
		category,
		license: null,
	};
}

describe("normalizeModelNameForMatch", () => {
	it("drops org prefix, @quant, and variant/format tokens", () => {
		expect(normalizeModelNameForMatch("Qwen/Qwen2.5-Coder-14B-Instruct")).toBe("qwen2.5-coder-14b");
		expect(normalizeModelNameForMatch("qwen2.5-coder-14b")).toBe("qwen2.5-coder-14b");
		expect(normalizeModelNameForMatch("google/gemma-4-E4B-it@q8_0")).toBe("gemma-4-e4b");
	});
});

describe("findLlmfitMatch / llmfitCapabilityPrior", () => {
	const db = [m("Qwen/Qwen2.5-Coder-14B-Instruct", 88, "Coding"), m("google/gemma-4-E4B-it", 72, "Multimodal")];

	it("matches a loaded id to its llmfit entry by normalized name", () => {
		expect(findLlmfitMatch("qwen2.5-coder-14b", db)?.name).toBe("Qwen/Qwen2.5-Coder-14B-Instruct");
	});

	it("returns llmfit's score + category as the cold-start prior", () => {
		expect(llmfitCapabilityPrior("qwen2.5-coder-14b", db)).toEqual({ score: 88, category: "Coding" });
	});

	it("returns null for an unknown / locally-renamed model (fall back to catalog/default)", () => {
		expect(llmfitCapabilityPrior("qwopus3.6-27b-v2-mlx", db)).toBeNull();
		expect(findLlmfitMatch("zz", db)).toBeNull();
	});

	it("returns null when llmfit scored the match null", () => {
		expect(
			llmfitCapabilityPrior("qwen2.5-coder-14b", [m("Qwen/Qwen2.5-Coder-14B-Instruct", null, "Coding")]),
		).toBeNull();
	});
});
