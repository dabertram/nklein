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
