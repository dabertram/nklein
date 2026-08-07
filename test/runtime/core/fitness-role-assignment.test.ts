import { describe, expect, it } from "vitest";
import {
	assignModelFromFitness,
	DEFAULT_FITNESS_ASSIGNMENT_POLICY,
	depthMatchedSamples,
} from "../../../src/core/fitness-role-assignment";
import type { FitnessRow } from "../../../src/core/fitness-table-schema";

/**
 * P25.3 phase 4 — the assigner's contract: depth-matched evidence or ABSTAIN (never read shallow evidence as
 * deep capability), Wilson confidence not raw rate, and a noise-band tie broken by evidence volume rather than
 * by a difference P22's own research calls noise.
 */
function row(overrides: Partial<FitnessRow> & { modelKey: string }): FitnessRow {
	return {
		modelKey: overrides.modelKey,
		role: overrides.role ?? "worker",
		difficultyTier: overrides.difficultyTier ?? "medium",
		sampleCount: overrides.sampleCount ?? 0,
		successCount: overrides.successCount ?? 0,
		retryBudget: overrides.retryBudget ?? 0,
		failureModes: overrides.failureModes ?? [],
		meanWallTimeMs: overrides.meanWallTimeMs ?? null,
		meanWallTimeSamples: overrides.meanWallTimeSamples ?? 0,
		tokensPerSec: overrides.tokensPerSec ?? null,
		tokensPerSecSamples: overrides.tokensPerSecSamples ?? 0,
		knowledgeUseCount: overrides.knowledgeUseCount ?? 0,
		knowledgeSkipCount: overrides.knowledgeSkipCount ?? 0,
		depthSamples: overrides.depthSamples ?? { shallow: 0, medium: 0, deep: 0 },
		updatedAt: overrides.updatedAt ?? null,
	};
}

describe("depthMatchedSamples", () => {
	it("counts only buckets that COVER the needed depth (deep needs deep; medium takes medium+deep; shallow takes all)", () => {
		const mixed = row({ modelKey: "m", depthSamples: { shallow: 7, medium: 3, deep: 2 } });
		expect(depthMatchedSamples(mixed, "deep")).toBe(2);
		expect(depthMatchedSamples(mixed, "medium")).toBe(5);
		expect(depthMatchedSamples(mixed, "shallow")).toBe(12);
	});
});

describe("assignModelFromFitness", () => {
	it("abstains with no_evidence when the cell has no rows at all", () => {
		expect(assignModelFromFitness({ rows: [], neededDepth: "medium" })).toEqual({
			kind: "abstain",
			reason: "no_evidence",
			detail: "no fitness row for this role/difficulty cell",
		});
	});

	it("a purely SHALLOW-measured cell never routes a DEEP card — absence of deep evidence is not deep capability", () => {
		const shallowOnly = row({
			modelKey: "shallow-star",
			sampleCount: 40,
			successCount: 39,
			depthSamples: { shallow: 40, medium: 0, deep: 0 },
		});
		const verdict = assignModelFromFitness({ rows: [shallowOnly], neededDepth: "deep" });
		expect(verdict.kind).toBe("abstain");
		if (verdict.kind === "abstain") {
			expect(verdict.reason).toBe("no_depth_matched_evidence");
		}
		// …while the SAME row happily routes a shallow card.
		const shallowCard = assignModelFromFitness({ rows: [shallowOnly], neededDepth: "shallow" });
		expect(shallowCard.kind).toBe("assigned");
	});

	it("one stray deep sample inside a mostly-shallow row does not qualify (the rate is other depths' evidence)", () => {
		const strayDeep = row({
			modelKey: "mostly-shallow",
			sampleCount: 100,
			successCount: 95,
			depthSamples: { shallow: 94, medium: 0, deep: 6 },
		});
		const verdict = assignModelFromFitness({ rows: [strayDeep], neededDepth: "deep" });
		expect(verdict.kind).toBe("abstain");
		if (verdict.kind === "abstain") {
			expect(verdict.reason).toBe("no_depth_matched_evidence");
			expect(verdict.detail).toContain("%");
		}
	});

	it("measured-and-bad abstains as below_confidence_floor, distinct from unmeasured", () => {
		const measuredBad = row({
			modelKey: "tried-and-failed",
			sampleCount: 20,
			successCount: 4,
			depthSamples: { shallow: 0, medium: 0, deep: 20 },
		});
		const verdict = assignModelFromFitness({ rows: [measuredBad], neededDepth: "deep" });
		expect(verdict.kind).toBe("abstain");
		if (verdict.kind === "abstain") {
			expect(verdict.reason).toBe("below_confidence_floor");
			expect(verdict.detail).toContain("tried-and-failed");
		}
	});

	it("assigns the highest-confidence depth-matched cell and names its runner-up", () => {
		const strong = row({
			modelKey: "strong",
			sampleCount: 50,
			successCount: 47,
			depthSamples: { shallow: 0, medium: 0, deep: 50 },
		});
		const weaker = row({
			modelKey: "weaker",
			sampleCount: 50,
			successCount: 33,
			depthSamples: { shallow: 0, medium: 0, deep: 50 },
		});
		const verdict = assignModelFromFitness({ rows: [weaker, strong], neededDepth: "deep" });
		expect(verdict.kind).toBe("assigned");
		if (verdict.kind === "assigned") {
			expect(verdict.modelKey).toBe("strong");
			expect(verdict.basis).toBe("highest_confidence");
			expect(verdict.runnerUp?.modelKey).toBe("weaker");
		}
	});

	it("a 1/1 cell cannot outrank a well-sampled one (Wilson lower bound, not raw rate)", () => {
		const lucky = row({
			modelKey: "lucky-one-shot",
			sampleCount: 6,
			successCount: 6,
			depthSamples: { shallow: 0, medium: 0, deep: 6 },
		});
		const proven = row({
			modelKey: "proven",
			sampleCount: 60,
			successCount: 57,
			depthSamples: { shallow: 0, medium: 0, deep: 60 },
		});
		const verdict = assignModelFromFitness({ rows: [lucky, proven], neededDepth: "deep" });
		expect(verdict.kind).toBe("assigned");
		if (verdict.kind === "assigned") {
			expect(verdict.modelKey).toBe("proven");
		}
	});

	it("within the noise band the MORE-EVIDENCED cell wins, not the marginally higher score", () => {
		// Two cells whose Wilson bounds land within the 0.07 noise band, one with far more depth evidence.
		// thin-lead: 30/30 → Wilson ≈ 0.887. deep-evidence: 185/200 → ≈ 0.880. Gap 0.007 ≪ the 0.07 band,
		// so the leader-by-score has NO real advantage — but 200 depth attempts vs 30 is a real difference.
		const marginallyHigher = row({
			modelKey: "thin-lead",
			sampleCount: 30,
			successCount: 30,
			depthSamples: { shallow: 0, medium: 0, deep: 30 },
		});
		const betterEvidenced = row({
			modelKey: "deep-evidence",
			sampleCount: 200,
			successCount: 185,
			depthSamples: { shallow: 0, medium: 0, deep: 200 },
		});
		const verdict = assignModelFromFitness({ rows: [marginallyHigher, betterEvidenced], neededDepth: "deep" });
		expect(verdict.kind).toBe("assigned");
		if (verdict.kind === "assigned") {
			expect(verdict.modelKey).toBe("deep-evidence");
			expect(verdict.basis).toBe("tie_broken_by_evidence");
			expect(verdict.reason).toContain("noise band");
		}
	});

	it("the default policy states its thresholds (5 attempts, half the row, 0.5 confidence, 0.07 noise)", () => {
		expect(DEFAULT_FITNESS_ASSIGNMENT_POLICY).toEqual({
			minDepthMatchedSamples: 5,
			minDepthMatchedShare: 0.5,
			minConfidence: 0.5,
			noiseBand: 0.07,
		});
	});
});
