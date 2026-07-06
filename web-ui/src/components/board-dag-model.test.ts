import type { RuntimeTaskSessionSummary } from "@runtime-contract";
import { describe, expect, it } from "vitest";
import { buildDagGraph, computeDepths, findCycleEdgeIds } from "@/components/board-dag-model";
import type { BoardColumn as BoardColumnModel, BoardDependency } from "@/types";

function dep(from: string, to: string): BoardDependency {
	return { id: `${from}->${to}`, fromTaskId: from, toTaskId: to, createdAt: 0 };
}

/** A minimal board column with the given card ids (title = id). */
function column(id: BoardColumnModel["id"], cardIds: string[]): BoardColumnModel {
	return {
		id,
		title: id,
		cards: cardIds.map((cardId) => ({ id: cardId, title: cardId })),
	} as BoardColumnModel;
}

describe("computeDepths", () => {
	it("assigns longest-path depth (roots 0, flowing along build order)", () => {
		// a → b → c, and a → c directly: c's longest path is a→b→c = depth 2.
		const dependsOn = new Map([
			["b", ["a"]],
			["c", ["b", "a"]],
		]);
		const depths = computeDepths(["a", "b", "c"], dependsOn);
		expect(depths.get("a")).toBe(0);
		expect(depths.get("b")).toBe(1);
		expect(depths.get("c")).toBe(2);
	});

	it("is cycle-guarded (a mutual cycle doesn't infinite-loop; re-entry contributes 0)", () => {
		const dependsOn = new Map([
			["a", ["b"]],
			["b", ["a"]],
		]);
		const depths = computeDepths(["a", "b"], dependsOn);
		// Both terminate with a finite depth (exact value is the guard's 0-at-reentry; the point is: no hang).
		expect(depths.get("a")).toBeTypeOf("number");
		expect(depths.get("b")).toBeTypeOf("number");
	});

	it("ignores self-edges and unknown deps", () => {
		const dependsOn = new Map([["a", ["a", "ghost"]]]);
		expect(computeDepths(["a"], dependsOn).get("a")).toBe(0);
	});
});

describe("findCycleEdgeIds", () => {
	it("returns empty for an acyclic graph", () => {
		const edges = [dep("a", "b"), dep("b", "c")];
		expect(findCycleEdgeIds(["a", "b", "c"], edges).size).toBe(0);
	});

	it("flags the back edge of a cycle", () => {
		// a → b → c → a: the c→a edge closes the cycle (a back edge).
		const edges = [dep("a", "b"), dep("b", "c"), dep("c", "a")];
		const cycleEdges = findCycleEdgeIds(["a", "b", "c"], edges);
		expect(cycleEdges.has("c->a")).toBe(true);
		// The forward edges are not themselves back edges.
		expect(cycleEdges.has("a->b")).toBe(false);
	});

	it("flags a 2-cycle's closing edge", () => {
		const edges = [dep("a", "b"), dep("b", "a")];
		const cycleEdges = findCycleEdgeIds(["a", "b"], edges);
		expect(cycleEdges.size).toBe(1); // exactly one back edge closes the 2-cycle
	});
});

describe("buildDagGraph", () => {
	const noSessions: Record<string, RuntimeTaskSessionSummary> = {};

	it("excludes trash cards and keeps only edges with both endpoints on the board", () => {
		const columns = [column("backlog", ["a", "b"]), column("trash", ["gone"])];
		const graph = buildDagGraph(columns, [dep("a", "b"), dep("a", "gone"), dep("x", "a")], noSessions);
		expect(graph.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
		expect(graph.edges.map((e) => e.id)).toEqual(["a->b"]); // a->gone (trash) and x->a (unknown) dropped
	});

	it("lays roots at x=pad and pushes dependents rightward by depth", () => {
		const columns = [column("backlog", ["a", "b"])];
		const graph = buildDagGraph(columns, [dep("a", "b")], noSessions);
		const a = graph.positions.get("a");
		const b = graph.positions.get("b");
		expect(a).toBeDefined();
		expect(b).toBeDefined();
		expect((b?.x ?? 0) > (a?.x ?? 0)).toBe(true); // b (depth 1) is right of a (depth 0)
	});

	it("marks node status from the live session (running / failed / blocked)", () => {
		// `blocked` has no session but a blockedKind on the card ⇒ failed styling.
		const columns = [
			{
				id: "in_progress",
				title: "in_progress",
				cards: [
					{ id: "run", title: "run" },
					{ id: "fail", title: "fail" },
					{ id: "blocked", title: "blocked", blockedKind: "needs_decomposition" },
				],
			} as BoardColumnModel,
		];
		const sessions = {
			run: { state: "running" } as RuntimeTaskSessionSummary,
			fail: { state: "failed" } as RuntimeTaskSessionSummary,
		};
		const graph = buildDagGraph(columns, [], sessions);
		const byId = new Map(graph.nodes.map((n) => [n.id, n]));
		expect(byId.get("run")?.running).toBe(true);
		expect(byId.get("fail")?.failed).toBe(true);
		expect(byId.get("blocked")?.failed).toBe(true);
	});

	it("detects a cycle across the whole board build", () => {
		const columns = [column("backlog", ["a", "b", "c"])];
		const graph = buildDagGraph(columns, [dep("a", "b"), dep("b", "c"), dep("c", "a")], noSessions);
		expect(graph.cycleEdgeIds.size).toBeGreaterThan(0);
	});
});
