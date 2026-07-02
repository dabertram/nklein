import { describe, expect, it } from "vitest";
import { applyDiversityPreference } from "../../../src/core/model-diversity";

const candidate = (modelId: string, score: number) => ({ modelKey: `lmstudio:${modelId}`, modelId, score });

describe("applyDiversityPreference (decision roles, margin-bounded hard preference)", () => {
	it("keeps the order when the top pick is already lineage-diverse", () => {
		const result = applyDiversityPreference({
			ranked: [candidate("qwen3.5-9b-mlx", 80), candidate("openai/gpt-oss-120b", 78)],
			avoidLineages: ["gpt-oss"],
		});
		expect(result.ranked[0]?.modelId).toBe("qwen3.5-9b-mlx");
		expect(result.diversityAchieved).toBe(true);
		expect(result.diversityWaivedReason).toBeNull();
	});

	it("promotes a diverse candidate within the margin over a same-lineage top pick (the live monoculture fix)", () => {
		// architect = gpt-oss; top reviewer candidate is ALSO gpt-oss; a qwen reviewer sits 10 pts behind.
		const result = applyDiversityPreference({
			ranked: [candidate("openai/gpt-oss-120b", 85), candidate("qwen3.5-9b-mlx", 75)],
			avoidLineages: ["gpt-oss"],
		});
		expect(result.ranked[0]?.modelId).toBe("qwen3.5-9b-mlx");
		expect(result.diversityAchieved).toBe(true);
		expect(result.rationale).toContain("Promoted");
	});

	it("does NOT promote a diverse candidate beyond the margin (diverse-but-unfit = negative synergy)", () => {
		const result = applyDiversityPreference({
			ranked: [candidate("openai/gpt-oss-120b", 85), candidate("qwen3.5-9b-mlx", 60)],
			avoidLineages: ["gpt-oss"],
			marginPts: 15,
		});
		expect(result.ranked[0]?.modelId).toBe("openai/gpt-oss-120b");
		expect(result.diversityAchieved).toBe(false);
		expect(result.diversityWaivedReason).toContain("within 15 fit points");
	});

	it("waives with a single-lineage-fleet reason when nothing diverse exists (qwen-only fleet)", () => {
		const result = applyDiversityPreference({
			ranked: [candidate("qwopus3.6-27b-v2-mlx", 85), candidate("qwopus3.5-4b-coder-mtp", 70)],
			avoidLineages: ["qwen"],
		});
		expect(result.diversityAchieved).toBe(false);
		expect(result.diversityWaivedReason).toContain("single-lineage fleet");
	});

	it("an unknown-lineage candidate never counts as diverse (per-machine alias safety)", () => {
		const result = applyDiversityPreference({
			ranked: [candidate("openai/gpt-oss-120b", 85), candidate("coder-gpu", 84)],
			avoidLineages: ["gpt-oss"],
		});
		expect(result.ranked[0]?.modelId).toBe("openai/gpt-oss-120b");
		expect(result.diversityAchieved).toBe(false);
	});

	it("unknown in the avoid set is ignored (carries no information)", () => {
		const result = applyDiversityPreference({
			ranked: [candidate("qwen3.5-9b-mlx", 80)],
			avoidLineages: ["unknown"],
		});
		expect(result.rationale).toContain("No lineages to avoid");
	});

	it("handles an empty candidate list", () => {
		const result = applyDiversityPreference({ ranked: [], avoidLineages: ["qwen"] });
		expect(result.diversityWaivedReason).toBe("no candidates");
	});
});
