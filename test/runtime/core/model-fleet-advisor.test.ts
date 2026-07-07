import { describe, expect, it } from "vitest";
import type { LoadedModelDescriptor } from "../../../src/core/lmstudio-loaded-model-descriptors";
import { adviseModelFleet } from "../../../src/core/model-fleet-advisor";

const desc = (modelKey: string, isEmbedding = false): LoadedModelDescriptor => ({
	runtimeId: modelKey,
	modelKey,
	isEmbedding,
});

const kinds = (descriptors: LoadedModelDescriptor[]) => adviseModelFleet(descriptors).map((s) => s.kind);

describe("adviseModelFleet", () => {
	it("warns when no agentic model is loaded (empty or embeddings only)", () => {
		expect(kinds([])).toEqual(["no_agentic_model"]);
		expect(kinds([desc("nomic-embed-text", true)])).toEqual(["no_agentic_model"]);
	});

	it("flags a single-base-family monoculture and names a different family to add", () => {
		// Both Qwen-lineage (qwen coder + a qwopus reasoning distill) → no uncorrelated reviewer possible.
		const result = adviseModelFleet([desc("qwen2.5-coder-14b"), desc("qwopus3.6-27b-v2")]);
		expect(result.map((s) => s.kind)).toContain("add_diverse_family");
		const diverse = result.find((s) => s.kind === "add_diverse_family");
		expect(diverse?.detail).toMatch(/Qwen/);
		expect(diverse?.detail).toMatch(/Mistral|Gemma|gpt-oss/); // suggests an absent family
		// qwopus is a reasoning kind → depth is covered, so no reasoning suggestion.
		expect(result.map((s) => s.kind)).not.toContain("add_reasoning_model");
	});

	it("treats a single loaded model as a monoculture (can't review its own work diversely)", () => {
		expect(kinds([desc("phi-4-reasoning-plus")])).toContain("add_diverse_family");
	});

	it("is quiet when the fleet is family-diverse AND has reasoning depth", () => {
		// Phi (reasoning) + Mistral/Devstral (agentic): 2 base families, a deep reasoner present → nothing to suggest.
		expect(adviseModelFleet([desc("phi-4-reasoning-plus"), desc("mistralai/devstral-small-2507")])).toEqual([]);
	});

	it("suggests a reasoner when the fleet is diverse but all shallow (code/chat only)", () => {
		// Qwen coder (code) + Gemma (chat): 2 families (diverse ✓) but no reasoning/agentic kind → depth gap only.
		const result = kinds([desc("qwen2.5-coder-14b"), desc("gemma-3-12b-it")]);
		expect(result).toContain("add_reasoning_model");
		expect(result).not.toContain("add_diverse_family");
	});
});
