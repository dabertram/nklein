import { describe, expect, it } from "vitest";
import {
	buildLearnedBudgetQualityCases,
	buildLearnedBudgetQualityPair,
	countLearnedBudgetArmTokens,
	type LearnedBudgetQualityScore,
	scoreLearnedBudgetQualityAnswer,
	summarizeLearnedBudgetQualityAb,
} from "../../../src/nklein-agent/nklein-learned-budget-quality-ab";

function score(passed: boolean): LearnedBudgetQualityScore {
	return {
		score: passed ? 1 : 0.75,
		passed,
		matchedValues: passed ? ["all"] : ["partial"],
		missingValues: passed ? [] : ["one"],
		leakedSupersededValues: [],
	};
}

describe("learned-budget quality A/B", () => {
	it("builds a sendable near-threshold control and compacts it through the production planner", () => {
		for (const case_ of buildLearnedBudgetQualityCases()) {
			const pair = buildLearnedBudgetQualityPair(case_);
			expect(pair.learnedBudgetTokens).toBe(32_000);
			expect(pair.plan.outcome).toBe("compacted");
			expect(pair.plan.originalProjectedTokens).toBeLessThanOrEqual(pair.learnedBudgetTokens);
			expect(pair.plan.projectedTokens).toBeLessThan(pair.plan.originalProjectedTokens);
			expect(countLearnedBudgetArmTokens(pair.learnedCompactedMessages)).toBeLessThan(
				countLearnedBudgetArmTokens(pair.overflowThresholdMessages),
			);

			const raw = JSON.stringify(pair.overflowThresholdMessages);
			const compacted = JSON.stringify(pair.learnedCompactedMessages);
			for (const expected of case_.expectedValues) {
				expect(raw).toContain(expected);
				expect(compacted).toContain(expected);
			}
			for (const superseded of case_.supersededValues) {
				expect(raw).toContain(superseded);
				expect(compacted).not.toContain(superseded);
			}
		}
	});

	it("scores exact contract retention and rejects superseded leakage", () => {
		const case_ = buildLearnedBudgetQualityCases()[0];
		expect(case_).toBeDefined();
		const exact = scoreLearnedBudgetQualityAnswer(case_.expectedValues.join(" "), case_);
		expect(exact).toMatchObject({ score: 1, passed: true, missingValues: [], leakedSupersededValues: [] });
		const leaked = scoreLearnedBudgetQualityAnswer(
			`${case_.expectedValues.join(" ")} ${case_.supersededValues[0]}`,
			case_,
		);
		expect(leaked.passed).toBe(false);
		expect(leaked.leakedSupersededValues).toEqual([case_.supersededValues[0]]);
	});

	it("requires small-model coverage and a capable-model no-regression control", () => {
		const passing = summarizeLearnedBudgetQualityAb([
			{
				modelId: "small-9b",
				modelTier: "small",
				caseId: "a",
				overflowThreshold: score(false),
				learnedCompacted: score(true),
			},
			{
				modelId: "capable-35b",
				modelTier: "capable",
				caseId: "a",
				overflowThreshold: score(true),
				learnedCompacted: score(true),
			},
		]);
		expect(passing).toMatchObject({ decision: "pass", smallModels: 1, capableModels: 1, capableRegressions: 0 });

		expect(
			summarizeLearnedBudgetQualityAb([
				{
					modelId: "small-9b",
					modelTier: "small",
					caseId: "a",
					overflowThreshold: score(true),
					learnedCompacted: score(true),
				},
			]),
		).toMatchObject({ decision: "inconclusive", capableModels: 0 });

		expect(
			summarizeLearnedBudgetQualityAb([
				{
					modelId: "small-9b",
					modelTier: "small",
					caseId: "a",
					overflowThreshold: score(true),
					learnedCompacted: score(true),
				},
				{
					modelId: "capable-35b",
					modelTier: "capable",
					caseId: "a",
					overflowThreshold: score(true),
					learnedCompacted: score(false),
				},
			]),
		).toMatchObject({ decision: "fail", capableRegressions: 1 });
	});
});
