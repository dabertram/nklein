import { describe, expect, it } from "vitest";
import {
	extractPlanRequirementStatements,
	findUncoveredPlanRequirements,
} from "../../../src/nklein-agent/decomposition/plan-requirement-coverage";
import type { NKleinPlanTask } from "../../../src/nklein-agent/nklein-plan-artifacts";

function task(over: Partial<NKleinPlanTask>): NKleinPlanTask {
	return {
		id: "task",
		title: "Implement requirement",
		prompt: "Implement the requirement.",
		dependsOn: [],
		complexity: 20,
		suggestedRole: null,
		filesLikelyTouched: [],
		acceptanceCommand: "npm test",
		testFirst: false,
		acceptanceTestPrompt: null,
		...over,
	};
}

describe("plan requirement coverage", () => {
	it("extracts markdown bullet and numbered requirements", () => {
		expect(extractPlanRequirementStatements("# Spec\n- Clamp scores.\n1. Test trends.\nPlain context.")).toEqual([
			"Clamp scores.",
			"Test trends.",
		]);
	});

	it("rejects a graph whose test contract silently omits trend and determinism invariants", () => {
		const spec = [
			"- calculateHabitScore must clamp its result to 0-100.",
			"- summarizeHabitWeek must classify trend as improving, declining, or steady.",
			"- The same input must always yield a deterministic stable recommendation.",
			"- src/index.ts must print score, trend, and recommendation.",
			"- All invariants must be asserted by npm test.",
		].join("\n");
		const tasks = [
			task({
				id: "scoring-cap",
				prompt: "Clamp calculateHabitScore to 0-100.",
				filesLikelyTouched: ["src/habit-score.ts"],
			}),
			task({
				id: "cli-output",
				prompt: "Print summary recommendation after the existing score and trend output in src/index.ts.",
				filesLikelyTouched: ["src/index.ts"],
			}),
			task({
				id: "tests",
				title: "Verify score cap and CLI",
				prompt: "Assert calculateHabitScore is capped and capture CLI recommendation output.",
				filesLikelyTouched: ["test/habit-score.test.js"],
			}),
		];

		const uncovered = findUncoveredPlanRequirements(spec, tasks);
		expect(uncovered.map((item) => item.requirement)).toEqual(
			expect.arrayContaining([
				"summarizeHabitWeek must classify trend as improving, declining, or steady.",
				"The same input must always yield a deterministic stable recommendation.",
				"All invariants must be asserted by npm test.",
			]),
		);
	});

	it("accepts existing behavior represented by explicit regression coverage", () => {
		const spec = [
			"- calculateHabitScore must clamp its result to 0-100.",
			"- summarizeHabitWeek must classify trend as improving, declining, or steady.",
			"- The same input must always yield a deterministic stable recommendation.",
			"- All invariants must be asserted by npm test.",
		].join("\n");
		const tasks = [
			task({ prompt: "Clamp calculateHabitScore to 0-100." }),
			task({
				id: "tests",
				title: "Verify all invariants",
				prompt:
					"Assert improving, declining, and steady trend branches. Repeat the same input to prove a deterministic stable recommendation. Run npm test for all invariants.",
			}),
		];

		expect(findUncoveredPlanRequirements(spec, tasks)).toEqual([]);
	});
});

describe("exact-invariant terms bind only on weakly-covered bullets (G6.8a live calibration 2026-07-28)", () => {
	const spec = "- 0 <= score <= 100 for every input; a perfect week is exactly 100.";

	it("does not fail a RICHLY-anchored card over a paraphrased quantifier", () => {
		// Two real 27–31B architects matched 7/2 anchors and were parked over the literal word "every" while
		// writing "all inputs" — paraphrase, not omission.
		const task = {
			id: "s1",
			title: "Score bounds",
			prompt:
				"Clamp the score so 0 <= score <= 100 holds for all inputs; a perfect week scores exactly 100. Verify the perfect-week input yields 100.",
			dependsOn: [],
		} as never;
		expect(findUncoveredPlanRequirements(spec, [task])).toEqual([]);
	});

	it("still demands the literal invariant on a weakly-covered bullet", () => {
		const vague = {
			id: "s1",
			title: "Wire the CLI",
			prompt: "Add the command-line entry point and print usage help.",
			dependsOn: [],
		} as never;
		const uncovered = findUncoveredPlanRequirements(spec, [vague]);
		expect(uncovered).toHaveLength(1);
	});

	it("requires only one anchor for a DESCRIPTIVE convention bullet (G6.8a v12 calibration)", () => {
		// Live v12 (many_small): these three layout/convention statements describe the world rather than demand
		// work, yet the full anchor quota parked the architect over them ("2/3", "1/2 required anchors").
		const conventionSpec = [
			"- No helper imports another helper (verifiable by inspecting each file's imports) — they are fully parallelizable.",
			"- Product source files are TypeScript under `src/**/*.ts`.",
			"- Test files may be plain JavaScript (`test/**/*.test.js`) or TypeScript (`test/**/*.test.ts`).",
		].join("\n");
		const card = {
			id: "helper-clamp",
			title: "Clamp helper",
			prompt: "Create src/clamp.ts exporting clamp(value). Add test/clamp.test.ts covering the bounds.",
			dependsOn: [],
		} as never;
		// One anchor each (src / test / helper) is enough for a description; no dedicated convention card needed.
		expect(findUncoveredPlanRequirements(conventionSpec, [card])).toEqual([]);
	});

	it("keeps the full anchor quota for NORMATIVE bullets even in convention-like phrasing", () => {
		const normativeSpec =
			"- All summaries must be deterministic and stable across repeated runs of the aggregation pipeline for identical input fixtures.";
		const unrelated = {
			id: "s1",
			title: "Wire the CLI",
			prompt: "Add the command-line entry point printing usage help for summaries.",
			dependsOn: [],
		} as never;
		// "must" makes it normative: one incidental anchor (summaries) must NOT satisfy it.
		expect(findUncoveredPlanRequirements(normativeSpec, [unrelated])).toHaveLength(1);
	});

	it("still surfaces a descriptive bullet the graph never mentions at all", () => {
		const conventionSpec = "- Product source files are TypeScript under `src/**/*.ts`.";
		const unrelated = {
			id: "s1",
			title: "Docs pass",
			prompt: "Rewrite the README quickstart section.",
			dependsOn: [],
		} as never;
		expect(findUncoveredPlanRequirements(conventionSpec, [unrelated])).toHaveLength(1);
	});
});
