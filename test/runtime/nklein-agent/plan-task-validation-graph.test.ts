import { describe, expect, it } from "vitest";
import {
	normalizeTaskAcceptanceCommand,
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

describe("normalizeTaskAcceptanceCommand", () => {
	it("lets a provided default acceptance command win over the task's own", () => {
		expect(
			normalizeTaskAcceptanceCommand(task({ acceptanceCommand: "npm test" }), "make check").acceptanceCommand,
		).toBe("make check");
		expect(normalizeTaskAcceptanceCommand(task({ acceptanceCommand: "npm test" }), null).acceptanceCommand).toBe(
			"npm test",
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
