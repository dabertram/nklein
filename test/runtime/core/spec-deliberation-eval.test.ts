import { describe, expect, it } from "vitest";
import {
	type SpecDeliberationEvalObservation,
	scoreSpecDeliberationObservation,
	summarizeSpecDeliberationEval,
} from "../../../src/core/spec-deliberation-eval";

const expected = [
	{ id: "window", keywordGroups: [["window"], ["fixed", "sliding"]] },
	{ id: "scope", keywordGroups: [["scope"], ["user", "tenant"]] },
] as const;

function row(overrides: Partial<SpecDeliberationEvalObservation>): SpecDeliberationEvalObservation {
	return {
		caseId: "rate-limit",
		arm: "plain_single_model",
		concerns: [],
		expected,
		modelCalls: 1,
		durationMs: 10,
		error: null,
		...overrides,
	};
}

describe("spec deliberation paired evaluation", () => {
	it("scores concept recall without rewarding unrelated question volume", () => {
		const scored = scoreSpecDeliberationObservation(
			row({ concerns: ["Which fixed or sliding window is required?", "Which database is fashionable?"] }),
		);
		expect(scored.matchedConceptIds).toEqual(["window"]);
		expect(scored.missedConceptIds).toEqual(["scope"]);
		expect(scored.falseConcernCount).toBe(1);
		expect(scored.qualityPass).toBe(true);
	});

	it("makes any invented concern fail a clear-spec case", () => {
		const scored = scoreSpecDeliberationObservation(row({ expected: [], concerns: ["Should this use Redis?"] }));
		expect(scored.recall).toBe(1);
		expect(scored.preciseEnough).toBe(false);
		expect(scored.qualityPass).toBe(false);
	});

	it("reports paired quality, cost, latency, errors, and false concerns separately", () => {
		const summary = summarizeSpecDeliberationEval([
			row({ arm: "plain_single_model", concerns: [] }),
			row({
				arm: "deliberation",
				concerns: ["Is rate limit scope per user or tenant?"],
				modelCalls: 3,
				durationMs: 20,
			}),
		]);
		expect(summary.plain.qualityPassRate).toBe(0);
		expect(summary.deliberation.qualityPassRate).toBe(1);
		expect(summary.conceptRecallDelta).toBe(0.5);
		expect(summary.modelCallMultiplier).toBe(3);
		expect(summary.pairedCaseCount).toBe(1);
	});
});
