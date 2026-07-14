import { describe, expect, it } from "vitest";
import { selectModelForAttempt } from "../../../src/core/attempt-model-selection";
import { emptyModelBehaviorProfile, type ModelBehaviorProfile } from "../../../src/core/model-behavior-profile";

const NOW = 1_000_000_000_000;

function profile(modelId: string, over: Partial<ModelBehaviorProfile>): ModelBehaviorProfile {
	return { ...emptyModelBehaviorProfile(modelId, NOW), ...over };
}

describe("selectModelForAttempt (F3.7 attempt-start selection core)", () => {
	it("prefers the learned winner (higher confidence-adjusted success first)", () => {
		const selection = selectModelForAttempt(
			[
				{
					modelId: "weak",
					profile: profile("weak", { samples: 10, successes: 3, successRate: 0.3, updatedAt: NOW }),
				},
				{
					modelId: "strong",
					profile: profile("strong", { samples: 10, successes: 9, successRate: 0.9, updatedAt: NOW }),
				},
			],
			{ now: NOW },
		);
		expect(selection.ordered[0]?.modelId).toBe("strong");
		expect(selection.ordered.map((r) => r.modelId)).toEqual(["strong", "weak"]);
		expect(selection.rationale).toContain("strong");
	});

	it("skips a PROVEN failure (enough fresh samples + success below the floor)", () => {
		const selection = selectModelForAttempt(
			[
				{
					modelId: "broken",
					profile: profile("broken", { samples: 8, successes: 0, successRate: 0.05, updatedAt: NOW }),
				},
				{ modelId: "ok", profile: profile("ok", { samples: 8, successes: 6, successRate: 0.75, updatedAt: NOW }) },
			],
			{ now: NOW },
		);
		expect(selection.ordered.map((r) => r.modelId)).toEqual(["ok"]);
		expect(selection.skipped).toEqual([{ modelId: "broken", reason: expect.stringContaining("proven failure") }]);
	});

	it("does NOT skip a low-success model that is UNPROVEN (too few samples) — keeps a cold-fleet runway", () => {
		const selection = selectModelForAttempt(
			[{ modelId: "new", profile: profile("new", { samples: 2, successes: 0, successRate: 0.0, updatedAt: NOW }) }],
			{ now: NOW, minSamplesToJudge: 4 },
		);
		// Under the judge threshold ⇒ not skipped; scores near-neutral because confidence is low (2/4).
		expect(selection.skipped).toEqual([]);
		expect(selection.ordered.map((r) => r.modelId)).toEqual(["new"]);
		expect(selection.ordered[0]?.score).toBeGreaterThan(0.2);
	});

	it("treats an unseen model (null profile) as a neutral prior so it competes and can build evidence", () => {
		const selection = selectModelForAttempt(
			[
				{ modelId: "unseen", profile: null },
				{
					modelId: "mediocre",
					profile: profile("mediocre", { samples: 10, successes: 4, successRate: 0.4, updatedAt: NOW }),
				},
			],
			{ now: NOW },
		);
		// Neutral 0.5 beats a confident 0.4 → the unseen model is explored ahead of a proven-mediocre one.
		expect(selection.ordered[0]?.modelId).toBe("unseen");
		expect(selection.ordered[0]?.score).toBeCloseTo(0.5);
	});

	it("decays a STALE strong record toward neutral (an old win no longer dominates a fresh contender)", () => {
		const twoWindows = 14 * 24 * 60 * 60 * 1000 * 2;
		const selection = selectModelForAttempt(
			[
				{
					modelId: "old-star",
					profile: profile("old-star", {
						samples: 20,
						successes: 20,
						successRate: 1.0,
						updatedAt: NOW - twoWindows,
					}),
				},
			],
			{ now: NOW },
		);
		// Fully stale (≥2× window) ⇒ freshness 0 ⇒ confidence 0 ⇒ score regressed to the neutral prior.
		expect(selection.ordered[0]?.score).toBeCloseTo(0.5);
		expect(selection.ordered[0]?.reason).toContain("stale");
	});

	it("skips a model whose learned complexity ceiling is below the task's tool count", () => {
		const selection = selectModelForAttempt(
			[
				{
					modelId: "narrow",
					profile: profile("narrow", {
						samples: 10,
						successes: 8,
						successRate: 0.8,
						complexityCeiling: 2,
						updatedAt: NOW,
					}),
				},
				{
					modelId: "broad",
					profile: profile("broad", {
						samples: 10,
						successes: 8,
						successRate: 0.8,
						complexityCeiling: 12,
						updatedAt: NOW,
					}),
				},
			],
			{ now: NOW, requiredToolCount: 6 },
		);
		expect(selection.ordered.map((r) => r.modelId)).toEqual(["broad"]);
		expect(selection.skipped[0]).toEqual({
			modelId: "narrow",
			reason: expect.stringContaining("below complexity ceiling"),
		});
	});

	it("reports the all-skipped case rather than picking an unfit model", () => {
		const selection = selectModelForAttempt(
			[
				{
					modelId: "broken",
					profile: profile("broken", { samples: 8, successes: 0, successRate: 0.0, updatedAt: NOW }),
				},
			],
			{ now: NOW },
		);
		expect(selection.ordered).toEqual([]);
		expect(selection.rationale).toContain("skipped as proven-unfit");
	});
});
