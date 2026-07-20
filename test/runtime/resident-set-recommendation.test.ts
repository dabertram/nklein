import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	COLD_LOAD_SECONDS,
	RESIDENCY_FITNESS_BAR,
	type ResidencyCandidate,
	recommendResidentSet,
} from "../../src/core/resident-set-recommendation";

const GB = 1_000_000_000;

function candidate(overrides: Partial<ResidencyCandidate> = {}): ResidencyCandidate {
	return {
		modelId: "qwen3-14b",
		sizeBytes: 9 * GB,
		measuredFitness: 0.8,
		observationCount: 20,
		requestCount: 10,
		...overrides,
	};
}

describe("recommendResidentSet", () => {
	it("recommends a well-measured, frequently-requested model", () => {
		const result = recommendResidentSet({ candidates: [candidate()], budgetBytes: 64 * GB });
		expect(result.recommended.map((m) => m.modelId)).toEqual(["qwen3-14b"]);
		expect(result.secondsSaved).toBe(9 * COLD_LOAD_SECONDS);
	});

	it("ranks by TIME SAVED, not by fitness — residency is about wall clock", () => {
		// A slightly-worse model requested 40× saves far more than an excellent one requested twice.
		const result = recommendResidentSet({
			candidates: [
				candidate({ modelId: "excellent-rare", measuredFitness: 0.95, requestCount: 2 }),
				candidate({ modelId: "good-common", measuredFitness: 0.6, requestCount: 40 }),
			],
			budgetBytes: 64 * GB,
		});
		expect(result.recommended[0]?.modelId).toBe("good-common");
	});

	it("excludes an UNMEASURED model — residency is exclusive", () => {
		const result = recommendResidentSet({
			candidates: [candidate({ measuredFitness: null })],
			budgetBytes: 64 * GB,
		});
		expect(result.excluded[0]?.reason).toBe("unmeasured");
		expect(result.excluded[0]?.detail).toContain("must not take a slot");
	});

	it("treats a thin measurement as thin evidence, not as a weak score", () => {
		const result = recommendResidentSet({
			candidates: [candidate({ observationCount: 2 })],
			budgetBytes: 64 * GB,
		});
		expect(result.excluded[0]?.reason).toBe("thin_evidence");
	});

	it("excludes a model below the fitness bar however often it is requested", () => {
		const result = recommendResidentSet({
			candidates: [candidate({ measuredFitness: RESIDENCY_FITNESS_BAR - 0.01, requestCount: 500 })],
			budgetBytes: 64 * GB,
		});
		expect(result.excluded[0]?.reason).toBe("below_fitness_bar");
		expect(result.excluded[0]?.detail).toContain("answering faster");
	});

	it("excludes a model requested once — residency would save nothing", () => {
		const result = recommendResidentSet({ candidates: [candidate({ requestCount: 1 })], budgetBytes: 64 * GB });
		expect(result.recommended).toEqual([]);
	});

	it("REFUSES to over-recommend past the usable budget", () => {
		// Over-recommending is worse than silence: the operator loads it, the machine swaps, and the slowdown gets
		// blamed on the model rather than on this advice.
		const result = recommendResidentSet({
			candidates: [
				candidate({ modelId: "a", sizeBytes: 20 * GB, requestCount: 50 }),
				candidate({ modelId: "b", sizeBytes: 20 * GB, requestCount: 40 }),
				candidate({ modelId: "c", sizeBytes: 20 * GB, requestCount: 30 }),
			],
			budgetBytes: 64 * GB, // usable = 48 GB after the 25% reserve
		});
		expect(result.bytesUsed).toBeLessThanOrEqual(result.bytesAvailable);
		expect(result.excluded.some((e) => e.reason === "no_room")).toBe(true);
	});

	it("says plainly that !Klein does not load", () => {
		const result = recommendResidentSet({ candidates: [candidate()], budgetBytes: 64 * GB });
		expect(result.summary).toContain("the operator does");
	});

	it("handles an empty fleet", () => {
		const result = recommendResidentSet({ candidates: [], budgetBytes: 64 * GB });
		expect(result.recommended).toEqual([]);
		expect(result.summary).toContain("never loads");
	});
});

describe("the no-auto-load constraint is enforced by SHAPE", () => {
	it("the recommendation carries NO executable action", () => {
		// The standing production constraint (David 2026-07-19) is that !Klein never auto-loads or auto-unloads.
		// Enforcing that by discipline fails the usual way: one convenience field, one dev-only flag, one default
		// flip. There is no field here a caller could execute, so the module cannot become an auto-loader by
		// increments. This test pins the absence.
		const source = readFileSync(new URL("../../src/core/resident-set-recommendation.ts", import.meta.url), "utf8");
		const code = source.slice(source.indexOf("export interface ResidencyCandidate"));
		expect(code).not.toMatch(/toLoad|toUnload|\bload\(|\bunload\(/);
	});
});
