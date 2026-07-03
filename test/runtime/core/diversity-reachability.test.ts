import { describe, expect, it } from "vitest";
import { assessDiversityReachability } from "../../../src/core/diversity-reachability";

const candidate = (modelId: string, score: number) => ({ modelKey: `lmstudio:${modelId}`, modelId, score });

describe("assessDiversityReachability (the self-review reachability guard)", () => {
	it("CENTERPIECE: a single-lineage pool whose lineage is avoided is NOT reachable — the guard names the trap", () => {
		// Every candidate is a qwen3_x variant (DECIDED: qwopus ⇒ ONE qwen lineage), and qwen is the author lineage
		// under review. There is literally no uncorrelated reviewer here — the pick would be judging its own family.
		const result = assessDiversityReachability({
			candidates: [candidate("qwopus3.6-27b-v2-mlx", 85), candidate("qwopus3.5-4b-coder-mtp", 70)],
			avoidLineages: ["qwen"],
		});
		expect(result.hasFullCoverage).toBe(false);
		expect(result.missingLineages).toEqual(["qwen"]); // the trapping lineage is NAMED, not hidden
		// And the delegated pick honestly waives diversity for the single-lineage fleet (surfaced, not silent).
		expect(result.preference.diversityAchieved).toBe(false);
		expect(result.preference.diversityWaivedReason).toContain("single-lineage fleet");
	});

	it("a lineage-diverse pool with a non-avoided lineage IS reachable (a real second opinion exists)", () => {
		// architect/author = gpt-oss; a qwen reviewer sits in the pool — an uncorrelated second opinion is reachable.
		const result = assessDiversityReachability({
			candidates: [candidate("openai/gpt-oss-120b", 85), candidate("qwen3.5-9b-mlx", 78)],
			avoidLineages: ["gpt-oss"],
		});
		expect(result.hasFullCoverage).toBe(true);
		expect(result.missingLineages).toEqual([]); // nothing is blocking, so nothing is reported
		// The delegate promotes the diverse qwen candidate within margin (proves composition reaches the real pick).
		expect(result.preference.ranked[0]?.modelId).toBe("qwen3.5-9b-mlx");
		expect(result.preference.diversityAchieved).toBe(true);
	});

	it("an empty candidate pool has no reachable reviewer", () => {
		const result = assessDiversityReachability({ candidates: [], avoidLineages: ["qwen"] });
		expect(result.hasFullCoverage).toBe(false);
		expect(result.missingLineages).toEqual([]); // nothing present to be trapped in
		expect(result.preference.diversityWaivedReason).toBe("no candidates");
	});

	it("an unknown-lineage candidate does NOT provide coverage (per-machine alias safety)", () => {
		// A custom LM Studio alias resolves to `unknown`, which might be a same-family model in disguise — it can
		// never count as a guaranteed-diverse reviewer, so a gpt-oss + alias pool avoiding gpt-oss stays unreachable.
		const result = assessDiversityReachability({
			candidates: [candidate("openai/gpt-oss-120b", 85), candidate("coder-gpu", 84)],
			avoidLineages: ["gpt-oss"],
		});
		expect(result.hasFullCoverage).toBe(false);
		expect(result.missingLineages).toEqual(["gpt-oss"]);
	});

	it("with nothing meaningful to avoid, any known-lineage candidate is trivially reachable", () => {
		// `unknown` in the avoid set carries no information and is dropped, so the gpt-oss pool is covered by itself.
		const result = assessDiversityReachability({
			candidates: [candidate("openai/gpt-oss-120b", 80)],
			avoidLineages: ["unknown"],
		});
		expect(result.hasFullCoverage).toBe(true);
		expect(result.missingLineages).toEqual([]);
	});
});
