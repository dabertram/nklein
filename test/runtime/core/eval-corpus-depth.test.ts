import { describe, expect, it } from "vitest";
import { estimateTextTokens } from "../../../src/core/eval-context-footprint";
import { EVAL_PROMPT_CORPUS } from "../../../src/core/eval-prompt-corpus";
import { classifyContextDepth } from "../../../src/core/model-fitness-freshness";

/**
 * P22.2 — the DEPTH of the evidence every fitness number is built from, measured rather than assumed.
 *
 * P22.2 states that "every fitness number we hold is effectively a shallow-context measurement". That was a
 * hypothesis. This file makes it a fact, and the fact is stronger than the hedge: **all 15 corpus prompts are
 * shallow, the largest at ~420 tokens, against !Klein's ≥32k context floor.** Every measured judgement about a
 * model's fitness was therefore taken at roughly 1-2% of the depth a real card runs at — and the depth research
 * in Phase 22 is precisely that capability at depth is not predicted by capability at depth 0.
 *
 * ── WHY THIS TEST PINS THE CURRENT STATE RATHER THAN DEMANDING A BETTER ONE ──
 * A test asserting "the corpus contains deep prompts" would fail today, and a red test in the suite is a test
 * people learn to skip. This instead pins the distribution EXACTLY, so the day someone adds a deep prompt the
 * assertion trips and they update it deliberately — turning an invisible property of the corpus into a decision.
 * The gap is recorded in todo P22.2; this makes it impossible to close by accident or to widen unnoticed.
 */
describe("eval corpus context depth", () => {
	const depths = EVAL_PROMPT_CORPUS.map((prompt) => estimateTextTokens(JSON.stringify(prompt)));

	it("is measured, not assumed — every prompt is classified", () => {
		expect(depths).toHaveLength(EVAL_PROMPT_CORPUS.length);
		expect(EVAL_PROMPT_CORPUS.length).toBeGreaterThan(0);
	});

	it("⚠️ is ENTIRELY SHALLOW today — this is P22.2's gap, quantified", () => {
		const distribution = { shallow: 0, medium: 0, deep: 0 };
		for (const tokens of depths) {
			distribution[classifyContextDepth(tokens)] += 1;
		}
		// When this trips because a deep prompt was added: that is PROGRESS. Update the expectation, and make sure
		// the fitness store actually records the new depth (P22.2's store side is ready and waiting for it).
		expect(distribution, "the corpus depth distribution changed — update this deliberately, see todo P22.2").toEqual({
			shallow: EVAL_PROMPT_CORPUS.length,
			medium: 0,
			deep: 0,
		});
	});

	it("⚠️ the largest prompt is ORDERS OF MAGNITUDE below the context floor", () => {
		// The number that makes the gap concrete: a few hundred tokens of evidence backing every routing decision
		// for cards that run at 32k+.
		const largest = Math.max(...depths);
		expect(largest).toBeLessThan(1_000);
		// Guard against the reverse mistake too — if this ever reads 0, the estimator or the corpus broke and the
		// "all shallow" finding above would be an artefact rather than a measurement.
		expect(largest).toBeGreaterThan(100);
	});
});
