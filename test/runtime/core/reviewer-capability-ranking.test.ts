import { describe, expect, it } from "vitest";
import {
	describeRankedCandidate,
	type RankedReviewerCandidate,
	type ReviewerCapabilityEvidence,
	type ReviewerRankingCandidate,
	rankReviewerCandidates,
	selectStrictlyStrongerCandidates,
} from "../../../src/core/reviewer-capability-ranking";

/**
 * P0.REVRANK. Reviewer/escalation ranking used to be class fit alone, so an UNCATALOGUED family landed on the
 * neutral `unknown` score (42) — below any catalogued mid-tier model. Live 2026-09-03: a catalogued 9B outranked an
 * uncatalogued 27B on every pick, and the stuck-review escalation "escalated" the 27B's review to the very 9B whose
 * three no-verdict sessions had caused the loop.
 *
 * These tests pin the contract the module states, especially the part that is easy to lose again: a missing
 * measurement is never a number.
 */

const evidence = (over: Partial<ReviewerCapabilityEvidence> = {}): ReviewerCapabilityEvidence => ({
	score: 70,
	basis: "observed",
	samples: 5,
	detail: "reviewer ledger 5 samples",
	...over,
});

const candidate = (over: Partial<ReviewerRankingCandidate> = {}): ReviewerRankingCandidate => ({
	modelKey: "m",
	modelId: "pub/m",
	classFit: { score: 50, eligible: true },
	capability: null,
	contextLength: 32_768,
	quantPenalty: 0,
	...over,
});

describe("rankReviewerCandidates", () => {
	it("gates on class eligibility: an ineligible model is excluded with a reason, never ranked low", () => {
		const ranking = rankReviewerCandidates([
			candidate({ modelKey: "tool-less", classFit: { score: 90, eligible: false } }),
			candidate({ modelKey: "ok", capability: evidence() }),
		]);
		expect(ranking.ranked.map((entry) => entry.modelKey)).toEqual(["ok"]);
		expect(ranking.excluded).toHaveLength(1);
		expect(ranking.excluded[0]).toMatchObject({ modelKey: "tool-less" });
		expect(ranking.excluded[0].reason).toMatch(/class-ineligible/u);
	});

	it("ranks by capability, not by class fit — the 27B-vs-9B inversion that caused the loop", () => {
		const ranking = rankReviewerCandidates([
			// The catalogued 9B: great class fit, modest measured capability.
			candidate({
				modelKey: "ornith-9b",
				classFit: { score: 72, eligible: true },
				capability: evidence({ score: 55 }),
			}),
			// The uncatalogued 27B: neutral class fit, strong measured capability.
			candidate({
				modelKey: "qwen-27b",
				classFit: { score: 42, eligible: true },
				capability: evidence({ score: 81 }),
			}),
		]);
		expect(ranking.ranked.map((entry) => entry.modelKey)).toEqual(["qwen-27b", "ornith-9b"]);
		expect(ranking.ranked[0].scoreBasis).toBe("capability");
	});

	it("never invents a score for a model with no evidence: it ranks after every measured candidate", () => {
		const ranking = rankReviewerCandidates([
			candidate({ modelKey: "unknown-strong", classFit: { score: 99, eligible: true }, capability: null }),
			candidate({
				modelKey: "measured-weak",
				classFit: { score: 10, eligible: true },
				capability: evidence({ score: 20 }),
			}),
		]);
		// A class fit of 99 does not beat a MEASUREMENT of 20, however small.
		expect(ranking.ranked.map((entry) => entry.modelKey)).toEqual(["measured-weak", "unknown-strong"]);
		expect(ranking.rankable.map((entry) => entry.modelKey)).toEqual(["measured-weak"]);
		expect(ranking.unrankable.map((entry) => entry.modelKey)).toEqual(["unknown-strong"]);
		const unknown = ranking.unrankable[0];
		expect(unknown.capability).toBeNull();
		expect(unknown.scoreBasis).toBe("class_fit");
	});

	it("orders the unrankable tail among itself by class fit, then serving", () => {
		const ranking = rankReviewerCandidates([
			candidate({ modelKey: "c", classFit: { score: 40, eligible: true } }),
			candidate({ modelKey: "a", classFit: { score: 60, eligible: true }, quantPenalty: 2 }),
			candidate({ modelKey: "b", classFit: { score: 60, eligible: true }, quantPenalty: 0 }),
		]);
		expect(ranking.unrankable.map((entry) => entry.modelKey)).toEqual(["b", "a", "c"]);
	});

	it("breaks equal capability by lighter quantization, then larger context, then key", () => {
		const ranking = rankReviewerCandidates([
			candidate({ modelKey: "heavy", capability: evidence(), quantPenalty: 2, contextLength: 131_072 }),
			candidate({ modelKey: "small-ctx", capability: evidence(), quantPenalty: 0, contextLength: 8_192 }),
			candidate({ modelKey: "big-ctx", capability: evidence(), quantPenalty: 0, contextLength: 131_072 }),
		]);
		expect(ranking.ranked.map((entry) => entry.modelKey)).toEqual(["big-ctx", "small-ctx", "heavy"]);
	});
});

describe("selectStrictlyStrongerCandidates — an escalation must be PROVEN stronger", () => {
	const ranked = (over: Partial<RankedReviewerCandidate> = {}): RankedReviewerCandidate => ({
		modelKey: "c",
		modelId: "pub/c",
		score: 70,
		scoreBasis: "capability",
		classFit: 50,
		capability: evidence(),
		contextLength: 32_768,
		quantPenalty: 0,
		...over,
	});

	it("qualifies a strictly higher capability", () => {
		const selection = selectStrictlyStrongerCandidates(
			[ranked({ modelKey: "stronger", capability: evidence({ score: 81 }) })],
			{ modelKey: "base", capability: evidence({ score: 70 }), contextLength: 32_768, quantPenalty: 0 },
		);
		expect(selection.qualified.map((entry) => entry.modelKey)).toEqual(["stronger"]);
		expect(selection.refusedReason).toBeNull();
		expect(selection.verdicts).toEqual([{ modelKey: "stronger", verdict: "stronger_capability" }]);
	});

	it("qualifies an equal capability served better, and refuses one served the same or worse", () => {
		const baseline = {
			modelKey: "base",
			capability: evidence({ score: 70 }),
			contextLength: 32_768,
			quantPenalty: 1,
		};
		const better = selectStrictlyStrongerCandidates([ranked({ modelKey: "lighter", quantPenalty: 0 })], baseline);
		expect(better.qualified.map((entry) => entry.modelKey)).toEqual(["lighter"]);
		expect(better.verdicts[0].verdict).toBe("stronger_serving");

		const same = selectStrictlyStrongerCandidates([ranked({ modelKey: "same", quantPenalty: 1 })], baseline);
		expect(same.qualified).toEqual([]);
		expect(same.verdicts[0].verdict).toBe("not_stronger");
		expect(same.refusedReason).toMatch(/no loaded candidate is strictly stronger than base/u);
	});

	it("refuses a candidate with no evidence — an unknown cannot be proven stronger", () => {
		const selection = selectStrictlyStrongerCandidates(
			[ranked({ modelKey: "unknown", capability: null, scoreBasis: "class_fit", classFit: 99 })],
			{ modelKey: "base", capability: evidence({ score: 20 }), contextLength: 32_768, quantPenalty: 0 },
		);
		expect(selection.qualified).toEqual([]);
		expect(selection.verdicts[0].verdict).toBe("no_evidence");
	});

	it("refuses everything when the BASELINE is unknown, and says why", () => {
		const selection = selectStrictlyStrongerCandidates(
			[ranked({ modelKey: "strong", capability: evidence({ score: 99 }) })],
			{ modelKey: "mystery", capability: null, contextLength: 32_768, quantPenalty: 0 },
		);
		expect(selection.qualified).toEqual([]);
		expect(selection.verdicts).toEqual([{ modelKey: "strong", verdict: "baseline_unknown" }]);
		expect(selection.refusedReason).toMatch(/nothing can be proven stronger than an unknown/u);
	});

	it("names the situation when nothing else is loaded at all", () => {
		const selection = selectStrictlyStrongerCandidates([], {
			modelKey: "base",
			capability: evidence({ score: 70 }),
			contextLength: 32_768,
			quantPenalty: 0,
		});
		expect(selection.refusedReason).toMatch(/no other routable model is loaded/u);
	});
});

describe("describeRankedCandidate", () => {
	it("says when a capability is unknown instead of printing a number", () => {
		const line = describeRankedCandidate({
			modelKey: "m",
			modelId: "pub/m",
			score: 42,
			scoreBasis: "class_fit",
			classFit: 42,
			capability: null,
			contextLength: 0,
			quantPenalty: 0,
		});
		expect(line).toContain("capability unknown");
		expect(line).not.toMatch(/capability 42/u);
	});

	it("carries the basis and sample count, so a prior never reads as a measurement", () => {
		const line = describeRankedCandidate({
			modelKey: "m",
			modelId: "pub/m",
			score: 50,
			scoreBasis: "capability",
			classFit: 42,
			capability: { score: 50, basis: "prior", samples: 0, detail: "catalog prior" },
			contextLength: 65_536,
			quantPenalty: 1,
		});
		expect(line).toContain("capability 50 (prior)");
		expect(line).toContain("quant penalty 1");
		expect(line).toContain("ctx 65536");
	});
});
