import { describe, expect, it } from "vitest";
import { breakDependencyCycles } from "../../../../src/nklein-agent/decomposition/plan-task-cycle-break";
import { type NKleinPlanTask, nkleinPlanTaskSchema } from "../../../../src/nklein-agent/nklein-plan-artifacts";

/** Minimal valid plan task — only `id` and `dependsOn` matter to cycle-breaking; the rest take schema defaults. */
function task(id: string, dependsOn: string[] = []): NKleinPlanTask {
	return nkleinPlanTaskSchema.parse({ id, title: id, prompt: `do ${id}`, dependsOn });
}

/** The invariant the runtime relies on: a valid `dependsOn` DAG always has ≥1 dependency-free source. */
function hasZeroDependencyRoot(tasks: readonly NKleinPlanTask[]): boolean {
	return tasks.some((t) => t.dependsOn.length === 0);
}

describe("breakDependencyCycles", () => {
	it("leaves an acyclic graph untouched (no broken edges, same task references)", () => {
		const tasks = [task("a"), task("b", ["a"]), task("c", ["a", "b"])];
		const result = breakDependencyCycles(tasks);
		expect(result.brokenEdges).toEqual([]);
		expect(result.tasks).toEqual(tasks);
		expect(result.tasks[1]).toBe(tasks[1]); // untouched references
		expect(hasZeroDependencyRoot(result.tasks)).toBe(true);
	});

	it("breaks a 2-cycle so a dependency-free root emerges", () => {
		// a ↔ b: each depends on the other ⇒ no root without repair (the live complex_dag failure shape).
		const tasks = [task("a", ["b"]), task("b", ["a"])];
		expect(hasZeroDependencyRoot(tasks)).toBe(false);

		const result = breakDependencyCycles(tasks);
		expect(result.brokenEdges).toHaveLength(1);
		expect(hasZeroDependencyRoot(result.tasks)).toBe(true);
		// Exactly one edge removed; the other direction is preserved.
		const totalDeps = result.tasks.reduce((n, t) => n + t.dependsOn.length, 0);
		expect(totalDeps).toBe(1);
	});

	it("breaks a self-loop", () => {
		const result = breakDependencyCycles([task("a", ["a"])]);
		expect(result.brokenEdges).toEqual([{ taskId: "a", dependsOnTaskId: "a" }]);
		expect(result.tasks[0].dependsOn).toEqual([]);
	});

	it("breaks a 3-cycle into an acyclic graph", () => {
		const tasks = [task("a", ["c"]), task("b", ["a"]), task("c", ["b"])];
		const result = breakDependencyCycles(tasks);
		expect(result.brokenEdges).toHaveLength(1);
		expect(hasZeroDependencyRoot(result.tasks)).toBe(true);
	});

	it("repairs the live shape (a 2-cycle with a tree hanging off it) into a startable DAG", () => {
		// doc ↔ score-bands cycle; the rest of the tree depends transitively on them. Before repair: no root.
		const tasks = [
			task("doc", ["score-bands"]),
			task("score-bands", ["doc"]),
			task("parse", ["doc"]),
			task("trends", ["doc"]),
			task("validate", ["parse"]),
			task("integrate", ["validate", "trends"]),
		];
		expect(hasZeroDependencyRoot(tasks)).toBe(false);

		const result = breakDependencyCycles(tasks);
		expect(result.brokenEdges).toHaveLength(1); // only the one back-edge in the cycle
		expect(hasZeroDependencyRoot(result.tasks)).toBe(true);
		// Non-cycle edges are preserved (parse still depends on doc, integrate on validate+trends).
		const byId = new Map(result.tasks.map((t) => [t.id, t]));
		expect(byId.get("parse")?.dependsOn).toEqual(["doc"]);
		expect(byId.get("integrate")?.dependsOn).toEqual(["validate", "trends"]);
	});

	it("is deterministic — the same input always drops the same edge", () => {
		const build = () => [task("a", ["b"]), task("b", ["a"])];
		const first = breakDependencyCycles(build());
		const second = breakDependencyCycles(build());
		expect(first.brokenEdges).toEqual(second.brokenEdges);
	});

	it("ignores dangling dependsOn ids (validation handles unknown refs) and stays acyclic", () => {
		const tasks = [task("a", ["ghost"]), task("b", ["a"])];
		const result = breakDependencyCycles(tasks);
		expect(result.brokenEdges).toEqual([]); // 'ghost' isn't a node ⇒ not a cycle
		expect(hasZeroDependencyRoot(result.tasks)).toBe(false); // a still "depends on" ghost — untouched here
	});
});
