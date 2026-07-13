import { describe, expect, it } from "vitest";
import {
	emptyFitnessRow,
	fitnessCellKey,
	fitnessConfidenceBand,
	fitnessConfidenceLowerBound,
	fitnessKnowledgeUseRate,
	fitnessRowSchema,
	fitnessSuccessRate,
	recordFitnessOutcome,
} from "../../../src/core/fitness-table-schema";

describe("fitnessRowSchema", () => {
	it("parses a full row", () => {
		const row = fitnessRowSchema.parse({
			modelKey: "qwen/qwen3-8b",
			role: "worker",
			difficultyTier: "hard",
			sampleCount: 10,
			successCount: 7,
			retryBudget: 2,
			failureModes: [{ kind: "tool_loop", count: 2 }],
			meanWallTimeMs: 4200,
			tokensPerSec: 85,
			updatedAt: 1,
		});
		expect(row.successCount).toBe(7);
		expect(row.failureModes[0]?.kind).toBe("tool_loop");
	});

	it("applies defaults for an unsampled cell", () => {
		const row = fitnessRowSchema.parse({ modelKey: "m", role: "reviewer", difficultyTier: "easy" });
		expect(row).toMatchObject({
			sampleCount: 0,
			successCount: 0,
			retryBudget: 0,
			failureModes: [],
			meanWallTimeMs: null,
			tokensPerSec: null,
			updatedAt: null,
		});
	});

	it("rejects an unknown difficulty tier + negative counts", () => {
		expect(fitnessRowSchema.safeParse({ modelKey: "m", role: "r", difficultyTier: "trivial" }).success).toBe(false);
		expect(
			fitnessRowSchema.safeParse({ modelKey: "m", role: "r", difficultyTier: "easy", sampleCount: -1 }).success,
		).toBe(false);
	});
});

describe("fitnessCellKey", () => {
	it("is a stable model×role×difficulty key", () => {
		expect(fitnessCellKey({ modelKey: "qwen/qwen3-8b", role: "worker", difficultyTier: "hard" })).toBe(
			"qwen/qwen3-8b::worker::hard",
		);
	});
});

describe("fitnessSuccessRate", () => {
	it("is successCount/sampleCount", () => {
		expect(fitnessSuccessRate({ sampleCount: 8, successCount: 6 })).toBe(0.75);
	});

	it("is 0 for an unsampled cell (no evidence)", () => {
		expect(fitnessSuccessRate({ sampleCount: 0, successCount: 0 })).toBe(0);
	});
});

describe("fitnessConfidenceLowerBound (F2.22)", () => {
	it("is 0 when unsampled and rises with more corroborating evidence at the same rate", () => {
		expect(fitnessConfidenceLowerBound({ sampleCount: 0, successCount: 0 })).toBe(0);
		const oneForOne = fitnessConfidenceLowerBound({ sampleCount: 1, successCount: 1 });
		const fortyFive = fitnessConfidenceLowerBound({ sampleCount: 50, successCount: 45 });
		// Both are 90-100% raw, but 45/50 is far more TRUSTED than 1/1 — the whole point of the measure.
		expect(fortyFive).toBeGreaterThan(oneForOne);
		expect(oneForOne).toBeLessThan(0.4); // a single success proves little
		expect(fortyFive).toBeGreaterThan(0.75);
	});
	it("stays within [0,1]", () => {
		expect(fitnessConfidenceLowerBound({ sampleCount: 4, successCount: 0 })).toBe(0);
		const perfect = fitnessConfidenceLowerBound({ sampleCount: 100, successCount: 100 });
		expect(perfect).toBeGreaterThan(0.9);
		expect(perfect).toBeLessThanOrEqual(1);
	});
});

describe("fitnessConfidenceBand (F2.22)", () => {
	it("bands by evidence volume", () => {
		expect(fitnessConfidenceBand(0)).toBe("none");
		expect(fitnessConfidenceBand(2)).toBe("low");
		expect(fitnessConfidenceBand(3)).toBe("medium");
		expect(fitnessConfidenceBand(9)).toBe("medium");
		expect(fitnessConfidenceBand(10)).toBe("high");
	});
});

describe("recordFitnessOutcome (write-side fold)", () => {
	const key = { modelKey: "prov:coder:default", role: "worker", difficultyTier: "medium" as const };

	it("empty row folds a success + a failure into counts, failure modes, and rolling means", () => {
		let r = emptyFitnessRow(key);
		expect(r.sampleCount).toBe(0);
		r = recordFitnessOutcome(r, { success: true, wallTimeMs: 1000, tokensPerSec: 40 }, 100);
		r = recordFitnessOutcome(r, { success: false, failureMode: "tool_loop", wallTimeMs: 3000 }, 200);
		expect(r.sampleCount).toBe(2);
		expect(r.successCount).toBe(1);
		expect(r.failureModes).toEqual([{ kind: "tool_loop", count: 1 }]);
		expect(fitnessSuccessRate(r)).toBe(0.5);
		expect(r.meanWallTimeMs).toBe(2000); // (1000 + 3000) / 2
		expect(r.tokensPerSec).toBe(40); // second attempt didn't report it → mean unchanged
		expect(r.updatedAt).toBe(200);
	});

	it("tallies repeated failure modes + preserves the key dimensions (pure — new row)", () => {
		const r0 = emptyFitnessRow(key);
		const r1 = recordFitnessOutcome(r0, { success: false, failureMode: "spec_drift" }, 1);
		const r2 = recordFitnessOutcome(r1, { success: false, failureMode: "spec_drift" }, 2);
		expect(r2.failureModes).toEqual([{ kind: "spec_drift", count: 2 }]);
		expect({ modelKey: r2.modelKey, role: r2.role, difficultyTier: r2.difficultyTier }).toEqual(key);
		expect(r0.sampleCount).toBe(0); // original untouched
	});

	it("rolls the wall-time mean incrementally across three attempts", () => {
		let r = emptyFitnessRow(key);
		for (const ms of [300, 600, 900]) {
			r = recordFitnessOutcome(r, { success: true, wallTimeMs: ms });
		}
		expect(r.meanWallTimeMs).toBe(600); // (300+600+900)/3
		expect(r.meanWallTimeSamples).toBe(3);
	});

	it("means over only the CONTRIBUTING samples — null-metric attempts don't skew it (regression)", () => {
		// wall times 1000, null, null, 3000 → mean of the TWO reported values is 2000 (not 1500 as when the divisor
		// was the total sample count). The intervening null attempts advance sampleCount but not the wall-time mean.
		let r = emptyFitnessRow(key);
		r = recordFitnessOutcome(r, { success: true, wallTimeMs: 1000 });
		r = recordFitnessOutcome(r, { success: true }); // no wall time
		r = recordFitnessOutcome(r, { success: false }); // no wall time
		r = recordFitnessOutcome(r, { success: true, wallTimeMs: 3000 });
		expect(r.sampleCount).toBe(4);
		expect(r.meanWallTimeMs).toBe(2000);
		expect(r.meanWallTimeSamples).toBe(2);
	});
});

describe("knowledge tallies (F1.1)", () => {
	const key = { modelKey: "prov:m:e", role: "worker", difficultyTier: "medium" } as const;

	it("folds known consultation/skip outcomes and leaves unknown attempts out of both tallies", () => {
		let row = emptyFitnessRow(key);
		row = recordFitnessOutcome(row, { success: true, usedKnowledgeTools: true });
		row = recordFitnessOutcome(row, { success: false, failureMode: "timeout", usedKnowledgeTools: false });
		row = recordFitnessOutcome(row, { success: true }); // unknown — advances neither tally
		row = recordFitnessOutcome(row, { success: true, usedKnowledgeTools: null });
		expect(row.knowledgeUseCount).toBe(1);
		expect(row.knowledgeSkipCount).toBe(1);
		expect(row.sampleCount).toBe(4);
		expect(fitnessKnowledgeUseRate(row)).toBeCloseTo(0.5, 5);
	});

	it("reports a null knowledge-use rate when no attempt answered either way", () => {
		expect(fitnessKnowledgeUseRate(emptyFitnessRow(key))).toBeNull();
	});
});
