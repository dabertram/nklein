import { describe, expect, it } from "vitest";
import {
	type DecomposedSubtask,
	type SubtaskDagDefectKind,
	validateSubtaskDag,
} from "../../../src/core/decomposition-subtask-dag";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function task(id: string, dependsOn: string[] = [], title?: string): DecomposedSubtask {
	return { id, dependsOn, title };
}

// ---------------------------------------------------------------------------
// Well-formed graphs
// ---------------------------------------------------------------------------

describe("validateSubtaskDag — well-formed", () => {
	it("accepts a linear chain and reports its shape (source/root/depth)", () => {
		const report = validateSubtaskDag([task("a"), task("b", ["a"]), task("c", ["b"])]);
		expect(report.ok).toBe(true);
		expect(report.defects).toHaveLength(0);
		expect(report.subtaskCount).toBe(3);
		expect(report.dependencyCount).toBe(2);
		expect(report.sourceIds).toEqual(["a"]); // nothing before "a"
		expect(report.rootIds).toEqual(["c"]); // nobody depends on "c"
		expect(report.componentCount).toBe(1);
		expect(report.disconnectedIds).toEqual([]);
		expect(report.maxDepth).toBe(3); // a → b → c
		expect(report.cycles).toEqual([]);
	});

	it("accepts a diamond (a fans into b,c which both feed d)", () => {
		const report = validateSubtaskDag([task("a"), task("b", ["a"]), task("c", ["a"]), task("d", ["b", "c"])]);
		expect(report.ok).toBe(true);
		expect(report.dependencyCount).toBe(4);
		expect(report.sourceIds).toEqual(["a"]);
		expect(report.rootIds).toEqual(["d"]);
		expect(report.componentCount).toBe(1);
		expect(report.maxDepth).toBe(3); // a → b → d (== a → c → d)
	});

	it("accepts an empty decomposition (no subtasks) as vacuously well-formed", () => {
		const report = validateSubtaskDag([]);
		expect(report.ok).toBe(true);
		expect(report.subtaskCount).toBe(0);
		expect(report.dependencyCount).toBe(0);
		expect(report.componentCount).toBe(0);
		expect(report.rootIds).toEqual([]);
		expect(report.sourceIds).toEqual([]);
		expect(report.maxDepth).toBe(0);
	});

	it("accepts a single lone subtask (not flagged disconnected — connectivity needs >1 node)", () => {
		const report = validateSubtaskDag([task("only")]);
		expect(report.ok).toBe(true);
		expect(report.disconnectedIds).toEqual([]);
		expect(report.componentCount).toBe(1);
		expect(report.rootIds).toEqual(["only"]);
		expect(report.sourceIds).toEqual(["only"]);
		expect(report.maxDepth).toBe(1);
	});

	it("treats a missing dependsOn (undefined) exactly like an empty list", () => {
		const report = validateSubtaskDag([{ id: "a" }, { id: "b", dependsOn: ["a"] }]);
		expect(report.ok).toBe(true);
		expect(report.sourceIds).toEqual(["a"]);
		expect(report.dependencyCount).toBe(1);
	});

	it("dedupes a repeated edge to the same dependency (counted + traversed once)", () => {
		const report = validateSubtaskDag([task("a"), task("b", ["a", "a", "a"])]);
		expect(report.ok).toBe(true);
		expect(report.dependencyCount).toBe(1);
		expect(report.maxDepth).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Duplicate ids
// ---------------------------------------------------------------------------

describe("validateSubtaskDag — duplicate ids", () => {
	it("flags a duplicate id and keeps the first occurrence canonical", () => {
		const report = validateSubtaskDag([task("a"), task("b", ["a"]), task("a")]);
		expect(report.ok).toBe(false);
		const dup = report.defects.find((d) => d.kind === "duplicate_id");
		expect(dup?.subtaskId).toBe("a");
		expect(dup?.message).toContain("Duplicate subtask id");
		// "b" still resolves its dependency to the (first) "a" — no spurious unknown_dependency.
		expect(report.defects.some((d) => d.kind === "unknown_dependency")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Unknown (dangling) dependencies
// ---------------------------------------------------------------------------

describe("validateSubtaskDag — unknown dependencies", () => {
	it("flags a dangling dependency with the missing id in relatedIds", () => {
		const report = validateSubtaskDag([task("a", ["ghost"])]);
		expect(report.ok).toBe(false);
		const unknown = report.defects.find((d) => d.kind === "unknown_dependency");
		expect(unknown?.subtaskId).toBe("a");
		expect(unknown?.relatedIds).toEqual(["ghost"]);
		expect(unknown?.message).toContain('unknown subtask "ghost"');
		// An unknown-dep edge is NOT counted as a real (known) dependency edge.
		expect(report.dependencyCount).toBe(0);
	});

	it("reports EVERY dangling dependency in one pass (no short-circuit, unlike the throw-on-first validator)", () => {
		const report = validateSubtaskDag([task("a", ["x", "y"]), task("b", ["z"])]);
		const unknowns = report.defects.filter((d) => d.kind === "unknown_dependency");
		expect(unknowns).toHaveLength(3);
		expect(new Set(unknowns.flatMap((d) => d.relatedIds))).toEqual(new Set(["x", "y", "z"]));
	});
});

// ---------------------------------------------------------------------------
// Self-dependency
// ---------------------------------------------------------------------------

describe("validateSubtaskDag — self dependency", () => {
	it("flags a self-edge distinctly from a multi-node cycle", () => {
		const report = validateSubtaskDag([task("a", ["a"], "Do the thing")]);
		expect(report.ok).toBe(false);
		const kinds = report.defects.map((d) => d.kind);
		expect(kinds).toContain("self_dependency");
		expect(kinds).not.toContain("dependency_cycle"); // reported as its own, more specific defect
		const self = report.defects.find((d) => d.kind === "self_dependency");
		expect(self?.subtaskId).toBe("a");
		expect(self?.message).toContain('Subtask a ("Do the thing")'); // title surfaced in the message
		expect(report.dependencyCount).toBe(0); // a self-edge is not a real dependency edge
		// A self-referential node is still connected to itself only; with no other node it is not "disconnected".
		expect(report.disconnectedIds).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Cycles — the gap the existing decomposition validation misses entirely
// ---------------------------------------------------------------------------

describe("validateSubtaskDag — cycles", () => {
	it("detects a 2-node mutual cycle (a↔b) that reference validation lets pass", () => {
		const report = validateSubtaskDag([task("a", ["b"]), task("b", ["a"])]);
		expect(report.ok).toBe(false);
		expect(report.cycles).toHaveLength(1);
		const cycle = report.defects.find((d) => d.kind === "dependency_cycle");
		expect(cycle).toBeDefined();
		// The reported path repeats its entry id at the end and contains both nodes.
		expect(new Set(cycle?.relatedIds)).toEqual(new Set(["a", "b"]));
		expect(cycle?.relatedIds[0]).toBe(cycle?.relatedIds[cycle.relatedIds.length - 1]);
		expect(cycle?.message).toContain("Dependency cycle");
		// No depth is computed while a cycle is present (longest-chain is undefined on a cyclic graph).
		expect(report.maxDepth).toBe(0);
	});

	it("detects a 3-node cycle (a→b→c→a) and reports the full node path", () => {
		const report = validateSubtaskDag([task("a", ["c"]), task("b", ["a"]), task("c", ["b"])]);
		expect(report.ok).toBe(false);
		expect(report.cycles).toHaveLength(1);
		const path = report.cycles[0] ?? [];
		expect(new Set(path.slice(0, -1))).toEqual(new Set(["a", "b", "c"]));
		expect(path[0]).toBe(path[path.length - 1]); // closes back onto itself
	});

	it("reports two independent cycles once each (not once per DFS entry point)", () => {
		const report = validateSubtaskDag([
			task("a", ["b"]),
			task("b", ["a"]), // cycle 1
			task("c", ["d"]),
			task("d", ["c"]), // cycle 2
		]);
		expect(report.cycles).toHaveLength(2);
		expect(report.defects.filter((d) => d.kind === "dependency_cycle")).toHaveLength(2);
	});

	it("dedupes the SAME cycle discovered from different entry points to a single report", () => {
		// Both a and b are sources of DFS but sit on one 3-cycle a→b→c→a.
		const report = validateSubtaskDag([
			task("a", ["c"]),
			task("b", ["a"]),
			task("c", ["b"]),
			task("standalone-root"),
		]);
		expect(report.cycles).toHaveLength(1);
	});

	it("still finds a cycle even when a duplicate id and a dangling dep are also present (all collected)", () => {
		const report = validateSubtaskDag([
			task("a", ["b"]),
			task("b", ["a", "missing"]), // cycle a↔b + a dangling dep
			task("a"), // duplicate id
		]);
		expect(new Set(report.defects.map((d) => d.kind))).toEqual(
			new Set<SubtaskDagDefectKind>(["dependency_cycle", "unknown_dependency", "duplicate_id"]),
		);
	});
});

// ---------------------------------------------------------------------------
// Disconnected subtasks / weak connectivity
// ---------------------------------------------------------------------------

describe("validateSubtaskDag — connectivity", () => {
	it("flags a subtask with no edge in either direction as disconnected", () => {
		const report = validateSubtaskDag([task("a"), task("b", ["a"]), task("lonely")]);
		expect(report.ok).toBe(false);
		const disc = report.defects.find((d) => d.kind === "disconnected_subtask");
		expect(disc?.subtaskId).toBe("lonely");
		expect(report.disconnectedIds).toEqual(["lonely"]);
		expect(report.componentCount).toBe(2); // {a,b} and {lonely}
	});

	it("does NOT flag a node that is depended on (incoming edge only) as disconnected", () => {
		// "a" has no dependsOn of its own but "b" depends on it → a has an (incoming) edge, so it is connected.
		const report = validateSubtaskDag([task("a"), task("b", ["a"])]);
		expect(report.disconnectedIds).toEqual([]);
		expect(report.ok).toBe(true);
	});

	it("counts weakly-connected components for two disjoint chains (an islanded decomposition)", () => {
		const report = validateSubtaskDag([task("a"), task("b", ["a"]), task("c"), task("d", ["c"])]);
		expect(report.componentCount).toBe(2);
		expect(report.disconnectedIds).toEqual([]); // every node has at least one edge
		expect(report.ok).toBe(true); // two connected islands are a shape signal, not a hard structural defect
		expect(report.rootIds).toEqual(["b", "d"]); // two deliverables, one per island (sorted)
		expect(report.sourceIds).toEqual(["a", "c"]);
	});

	it("reports multiple disconnected islands sorted, and the component count includes each", () => {
		const report = validateSubtaskDag([task("a", ["b"]), task("b"), task("z-lonely"), task("m-lonely")]);
		expect(report.disconnectedIds).toEqual(["m-lonely", "z-lonely"]); // sorted
		expect(report.componentCount).toBe(3); // {a,b}, {m-lonely}, {z-lonely}
	});
});

// ---------------------------------------------------------------------------
// Determinism + purity
// ---------------------------------------------------------------------------

describe("validateSubtaskDag — determinism & purity", () => {
	it("is deterministic across repeated calls on the same input", () => {
		const subtasks = [task("c", ["b"]), task("b", ["a"]), task("a"), task("island")];
		const first = validateSubtaskDag(subtasks);
		const second = validateSubtaskDag(subtasks);
		expect(second).toEqual(first);
	});

	it("does not mutate the input array or its subtask objects", () => {
		const input: DecomposedSubtask[] = [task("a", ["b"]), task("b", ["a"])];
		const snapshot = JSON.parse(JSON.stringify(input));
		validateSubtaskDag(input);
		expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
	});

	it("produces sorted rootIds/sourceIds/disconnectedIds regardless of input order", () => {
		const report = validateSubtaskDag([task("z"), task("a"), task("m", ["z", "a"])]);
		// z and a are both sources; m depends on both, so the only root is m.
		expect(report.sourceIds).toEqual(["a", "z"]);
		expect(report.rootIds).toEqual(["m"]);
	});
});
