import { describe, expect, it } from "vitest";
import { fitnessCellKey, fitnessRowSchema, fitnessSuccessRate } from "../../../src/core/fitness-table-schema";

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
