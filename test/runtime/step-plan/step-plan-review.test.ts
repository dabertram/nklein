import { describe, expect, it } from "vitest";
import {
	decideStepPlanReviewRound,
	findingsNamingUnknownSteps,
	renderReviewFindings,
	renderStepPlanReviewChecklist,
	STEP_PLAN_REVIEW_CATEGORIES,
	STEP_PLAN_REVIEW_CHECKLIST,
	stepPlanReviewSubmissionSchema,
} from "../../../src/core/step-plan-review";

describe("the reviewer checklist", () => {
	it("has one testable question per category and renders every non-other category numbered with its id", () => {
		for (const category of STEP_PLAN_REVIEW_CATEGORIES) {
			expect(STEP_PLAN_REVIEW_CHECKLIST[category].length).toBeGreaterThan(20);
		}
		const rendered = renderStepPlanReviewChecklist();
		expect(rendered).toContain("1. completeness:");
		expect(rendered).toContain("fact_from_memory: Does any step state an API signature");
		expect(rendered).not.toContain("other:");
	});
});

describe("stepPlanReviewSubmissionSchema", () => {
	it("accepts an approval without findings and normalizes finding categories", () => {
		expect(stepPlanReviewSubmissionSchema.parse({ verdict: "approve", summary: "fine" }).findings).toEqual([]);
		const parsed = stepPlanReviewSubmissionSchema.parse({
			verdict: "revise",
			summary: "two gaps",
			findings: [
				{ category: "Fact From Memory", stepId: "print", fix: "add a verify block" },
				{ category: "made-up", stepId: "", fix: "something" },
			],
		});
		expect(parsed.findings[0]).toEqual({ category: "fact_from_memory", stepId: "print", fix: "add a verify block" });
		expect(parsed.findings[1]).toEqual({ category: "other", stepId: null, fix: "something" });
	});

	it("tolerates a single finding object where a list was expected", () => {
		const parsed = stepPlanReviewSubmissionSchema.parse({
			verdict: "revise",
			summary: "s",
			findings: { category: "ambiguity", fix: "name the file" },
		});
		expect(parsed.findings).toHaveLength(1);
	});

	it("refuses a revise verdict with no findings (a bounce the planner cannot act on)", () => {
		expect(stepPlanReviewSubmissionSchema.safeParse({ verdict: "revise", summary: "meh" }).success).toBe(false);
	});
});

describe("renderReviewFindings / findingsNamingUnknownSteps", () => {
	it("renders category, step and fix; flags findings that name steps the plan lacks", () => {
		const findings = [
			{ category: "ambiguity" as const, stepId: "a", fix: "say which file" },
			{ category: "completeness" as const, stepId: null, fix: "add tests" },
			{ category: "missing_files" as const, stepId: "zzz", fix: "x" },
		];
		expect(renderReviewFindings(findings)).toBe(
			"- [ambiguity] step a: say which file\n- [completeness] add tests\n- [missing_files] step zzz: x",
		);
		expect(findingsNamingUnknownSteps({ steps: [{ id: "a" }] as never }, findings).map((f) => f.stepId)).toEqual([
			"zzz",
		]);
	});
});

describe("decideStepPlanReviewRound", () => {
	it("executes on approval regardless of round", () => {
		expect(
			decideStepPlanReviewRound({ round: 2, maxRounds: 2, verdict: "approve", allowUnreviewedWhenNoVerdict: false })
				.action,
		).toBe("execute");
	});

	it("revises while rounds remain and falls back when they are exhausted", () => {
		expect(
			decideStepPlanReviewRound({ round: 1, maxRounds: 2, verdict: "revise", allowUnreviewedWhenNoVerdict: false })
				.action,
		).toBe("revise");
		expect(
			decideStepPlanReviewRound({ round: 2, maxRounds: 2, verdict: "revise", allowUnreviewedWhenNoVerdict: false })
				.action,
		).toBe("fallback_unplanned");
	});

	it("waives review only on the FIRST round and only when allowed; a later missing verdict falls back", () => {
		expect(
			decideStepPlanReviewRound({ round: 1, maxRounds: 2, verdict: null, allowUnreviewedWhenNoVerdict: true })
				.action,
		).toBe("execute_unreviewed");
		expect(
			decideStepPlanReviewRound({ round: 1, maxRounds: 2, verdict: null, allowUnreviewedWhenNoVerdict: false })
				.action,
		).toBe("fallback_unplanned");
		expect(
			decideStepPlanReviewRound({ round: 2, maxRounds: 3, verdict: null, allowUnreviewedWhenNoVerdict: true })
				.action,
		).toBe("fallback_unplanned");
	});
});
