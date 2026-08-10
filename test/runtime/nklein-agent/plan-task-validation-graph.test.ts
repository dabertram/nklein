import { describe, expect, it } from "vitest";
import {
	normalizeTaskAcceptanceCommand,
	validateNKleinPlanTaskGraph,
	validateTaskGraphReferences,
	validateTaskSizingContract,
} from "../../../src/nklein-agent/decomposition/plan-task-validation";
import type { NKleinPlanTask, NKleinPlanTaskGraph } from "../../../src/nklein-agent/nklein-plan-artifacts";

function task(over: Partial<NKleinPlanTask> = {}): NKleinPlanTask {
	return {
		id: "t1",
		title: "Task 1",
		prompt: "do the thing",
		dependsOn: [],
		complexity: 50,
		suggestedRole: null,
		filesLikelyTouched: [],
		acceptanceCommand: "npm test",
		testFirst: false,
		acceptanceTestPrompt: null,
		knowledgeDebt: null,
		...over,
	};
}

function graph(tasks: NKleinPlanTask[]): NKleinPlanTaskGraph {
	return { schemaVersion: 1, slug: "proj", title: "Proj", tasks };
}

describe("validateTaskSizingContract", () => {
	it("accepts a well-sized task", () => {
		expect(() => validateTaskSizingContract(task())).not.toThrow();
		expect(() =>
			validateTaskSizingContract(task({ complexity: 75, filesLikelyTouched: ["a", "b", "c"] })),
		).not.toThrow();
	});

	it("requires an acceptance command", () => {
		expect(() => validateTaskSizingContract(task({ acceptanceCommand: null }))).toThrow(
			/missing an acceptanceCommand/u,
		);
		expect(() => validateTaskSizingContract(task({ acceptanceCommand: "   " }))).toThrow(
			/missing an acceptanceCommand/u,
		);
	});

	it("requires an acceptance test prompt when test-first", () => {
		expect(() => validateTaskSizingContract(task({ testFirst: true, acceptanceTestPrompt: null }))).toThrow(
			/test-first but missing/u,
		);
		expect(() =>
			validateTaskSizingContract(task({ testFirst: true, acceptanceTestPrompt: "write a failing test" })),
		).not.toThrow();
	});

	it("rejects a test-first card whose bounded scope cannot contain a test", () => {
		expect(() =>
			validateTaskSizingContract(
				task({
					testFirst: true,
					acceptanceTestPrompt: "add all branch tests",
					filesLikelyTouched: ["src/habit-score.ts"],
					writeScope: ["src/habit-score.ts"],
				}),
			),
		).toThrow(/writeScope only permits exact non-test files/u);
		expect(() =>
			validateTaskSizingContract(
				task({
					testFirst: true,
					acceptanceTestPrompt: "add all branch tests",
					writeScope: ["src/**"],
				}),
			),
		).not.toThrow();
		expect(() =>
			validateTaskSizingContract(
				task({
					testFirst: true,
					acceptanceTestPrompt: "add all branch tests",
					writeScope: ["test/habit-score.test.js"],
				}),
			),
		).not.toThrow();
	});

	it("rejects an over-complex or too-wide task (split-before-decompose)", () => {
		expect(() => validateTaskSizingContract(task({ complexity: 76 }))).toThrow(/complexity/u);
		expect(() => validateTaskSizingContract(task({ filesLikelyTouched: ["a", "b", "c", "d"] }))).toThrow(
			/likely files/u,
		);
	});
});

describe("validateTaskGraphReferences", () => {
	it("counts dependency edges for a valid graph", () => {
		expect(validateTaskGraphReferences(graph([task({ id: "a" }), task({ id: "b", dependsOn: ["a"] })]))).toBe(1);
		expect(
			validateTaskGraphReferences(
				graph([task({ id: "a" }), task({ id: "b", dependsOn: ["a"] }), task({ id: "c", dependsOn: ["a", "b"] })]),
			),
		).toBe(3);
	});

	it("rejects duplicate task ids", () => {
		expect(() => validateTaskGraphReferences(graph([task({ id: "a" }), task({ id: "a" })]))).toThrow(
			/duplicate task id a/u,
		);
	});

	it("rejects a dependency on an unknown task", () => {
		expect(() => validateTaskGraphReferences(graph([task({ id: "a", dependsOn: ["ghost"] })]))).toThrow(
			/depends on unknown task ghost/u,
		);
	});
});

describe("validateNKleinPlanTaskGraph sizing collection", () => {
	it("one bounce carries EVERY sizing violation, not just the first (live 20260810-195244)", () => {
		// The finalize used to bounce once per violating task, costing the model a full repair round-trip each;
		// one bounce with the whole worklist lets one repair round fix them all.
		const bad = graph([
			task({ id: "a", acceptanceCommand: null }),
			task({ id: "b" }),
			task({ id: "c", complexity: 99 }),
		]);
		let message = "";
		try {
			validateNKleinPlanTaskGraph({ taskGraph: bad });
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain("2 tasks failed the sizing contract");
		expect(message).toContain("Task a is missing an acceptanceCommand");
		expect(message).toContain("Task c has complexity 99/100");
	});

	it("a single violation keeps its original, un-wrapped message", () => {
		expect(() => validateNKleinPlanTaskGraph({ taskGraph: graph([task({ id: "a", complexity: 99 })]) })).toThrow(
			/^Task a has complexity 99\/100/u,
		);
	});
});

describe("normalizeTaskAcceptanceCommand", () => {
	it("fill-only: the task's own acceptance command wins over a provided default (2026-07-05 decision)", () => {
		expect(
			normalizeTaskAcceptanceCommand(task({ acceptanceCommand: "npm test" }), "make check").acceptanceCommand,
		).toBe("npm test");
		expect(normalizeTaskAcceptanceCommand(task({ acceptanceCommand: "npm test" }), null).acceptanceCommand).toBe(
			"npm test",
		);
	});

	it("fills from the default only when the task omits its own", () => {
		expect(normalizeTaskAcceptanceCommand(task({ acceptanceCommand: "" }), "make check").acceptanceCommand).toBe(
			"make check",
		);
	});

	it("clears test-first when there is no acceptance test prompt, and trims the prompt otherwise", () => {
		expect(
			normalizeTaskAcceptanceCommand(task({ testFirst: true, acceptanceTestPrompt: null }), null).testFirst,
		).toBe(false);
		const normalized = normalizeTaskAcceptanceCommand(
			task({ testFirst: true, acceptanceTestPrompt: "  write the test  " }),
			null,
		);
		expect(normalized.testFirst).toBe(true);
		expect(normalized.acceptanceTestPrompt).toBe("write the test");
	});

	it("dedupes and trims dependsOn", () => {
		expect(normalizeTaskAcceptanceCommand(task({ dependsOn: ["a", "a", " b ", ""] }), null).dependsOn).toEqual([
			"a",
			"b",
		]);
	});
});
