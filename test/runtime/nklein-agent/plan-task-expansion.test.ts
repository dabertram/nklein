import { describe, expect, it } from "vitest";
import {
	expandDecomposeProjectTasks,
	formatExpansionRevisionMarkdown,
	getReplacementBoundaryTaskIds,
	uniqStrings,
} from "../../../src/nklein-agent/decomposition/plan-task-expansion";
import type { NKleinPlanTask } from "../../../src/nklein-agent/nklein-plan-artifacts";

function task(id: string, dependsOn: string[] = []): NKleinPlanTask {
	return {
		id,
		title: id,
		prompt: `do ${id}`,
		dependsOn,
		complexity: 50,
		suggestedRole: null,
		filesLikelyTouched: [],
		acceptanceCommand: "npm test",
		testFirst: false,
		acceptanceTestPrompt: null,
		knowledgeDebt: null,
	};
}

const ids = (tasks: NKleinPlanTask[]): string[] => tasks.map((t) => t.id);
const depsOf = (tasks: NKleinPlanTask[], id: string): string[] => tasks.find((t) => t.id === id)?.dependsOn ?? [];

describe("uniqStrings", () => {
	it("trims, drops empties, and dedupes preserving first-seen order", () => {
		expect(uniqStrings(["a", " a ", "", "  ", "b"])).toEqual(["a", "b"]);
	});
});

describe("formatExpansionRevisionMarkdown", () => {
	it("returns null when no task was actually expanded", () => {
		expect(formatExpansionRevisionMarkdown({})).toBeNull();
		expect(formatExpansionRevisionMarkdown({ a: [] })).toBeNull();
	});

	it("renders the expansion mapping", () => {
		const md = formatExpansionRevisionMarkdown({ a: [task("a1"), task("a2")] });
		expect(md).toContain("# Revisions");
		expect(md).toContain("recursive_split");
		expect(md).toContain("a -> a1, a2");
	});
});

describe("getReplacementBoundaryTaskIds", () => {
	it("finds entry + terminal nodes of a linear chain", () => {
		const { entryTaskIds, terminalTaskIds } = getReplacementBoundaryTaskIds([
			task("a"),
			task("b", ["a"]),
			task("c", ["b"]),
		]);
		expect(entryTaskIds).toEqual(["a"]);
		expect(terminalTaskIds).toEqual(["c"]);
	});

	it("treats parallel tasks as both entry and terminal", () => {
		const { entryTaskIds, terminalTaskIds } = getReplacementBoundaryTaskIds([task("a"), task("b")]);
		expect(entryTaskIds).toEqual(["a", "b"]);
		expect(terminalTaskIds).toEqual(["a", "b"]);
	});

	it("throws on a cyclic replacement graph", () => {
		expect(() => getReplacementBoundaryTaskIds([task("a", ["b"]), task("b", ["a"])])).toThrow(/acyclic/u);
	});
});

describe("expandDecomposeProjectTasks", () => {
	it("returns the tasks unchanged when there is nothing to expand", () => {
		const out = expandDecomposeProjectTasks({
			tasks: [task("a"), task("b", ["a"])],
			expansions: {},
			defaultAcceptanceCommand: null,
		});
		expect(ids(out)).toEqual(["a", "b"]);
		expect(depsOf(out, "b")).toEqual(["a"]);
	});

	it("replaces a task with its sub-graph and rewires dependents to the terminal node", () => {
		// b depended on a; a expands into a1 -> a2. b must now depend on a2 (a's terminal).
		const out = expandDecomposeProjectTasks({
			tasks: [task("a"), task("b", ["a"])],
			expansions: { a: [task("a1"), task("a2", ["a1"])] },
			defaultAcceptanceCommand: null,
		});
		expect(ids(out).sort()).toEqual(["a1", "a2", "b"]); // parent "a" is gone
		expect(depsOf(out, "a2")).toEqual(["a1"]);
		expect(depsOf(out, "b")).toEqual(["a2"]);
	});

	it("throws on an empty replacement list, an unknown expansion id, a depth-limit breach, and a cycle", () => {
		expect(() =>
			expandDecomposeProjectTasks({ tasks: [task("a")], expansions: { a: [] }, defaultAcceptanceCommand: null }),
		).toThrow(/at least one replacement/u);

		expect(() =>
			expandDecomposeProjectTasks({
				tasks: [task("a")],
				expansions: { ghost: [task("x")] },
				defaultAcceptanceCommand: null,
			}),
		).toThrow(/unknown task id ghost/u);

		expect(() =>
			expandDecomposeProjectTasks({
				tasks: [task("a")],
				expansions: { a: [task("b")], b: [task("c")] },
				defaultAcceptanceCommand: null,
				maxDepth: 1,
			}),
		).toThrow(/expansion depth limit/u);

		expect(() =>
			expandDecomposeProjectTasks({
				tasks: [task("a")],
				expansions: { a: [task("a")] },
				defaultAcceptanceCommand: null,
				maxDepth: 5,
			}),
		).toThrow(/cycle/u);
	});
});
