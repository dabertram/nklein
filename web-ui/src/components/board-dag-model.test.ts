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

	it("lays BLOCKERS left under the early-left toggle (2026-07-10 board-aligned direction)", () => {
		const columns = [column("backlog", ["a", "b"])];
		// dep(a, b) = "a depends on b" (core semantics): b must land FIRST. Under early-left b is the left/root
		// layer. F2.31 (2026-09-02) flipped the DEFAULT to early-right; this direction lives behind the toggle.
		const graph = buildDagGraph(columns, [dep("a", "b")], noSessions, { flowDirection: "early-left" });
		const a = graph.positions.get("a");
		const b = graph.positions.get("b");
		expect(a).toBeDefined();
		expect(b).toBeDefined();
		expect((a?.x ?? 0) > (b?.x ?? 0)).toBe(true); // a (dependent, depth 1) is right of b (blocker, depth 0)
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

describe("buildDagGraph layout (F2.31 flow + tree structure)", () => {
	const col = (id: string, cards: { id: string; title: string }[]) => ({ id, title: id, cards }) as never;
	const dep = (from: string, to: string) => ({ id: `${from}->${to}`, fromTaskId: from, toTaskId: to }) as never;

	it("early-right (default): depth-0 roots sit in the RIGHTMOST column, dependents flow left", () => {
		const graph = buildDagGraph(
			[
				col("planning", [
					{ id: "root", title: "Root" },
					{ id: "mid", title: "Mid" },
					{ id: "leaf", title: "Leaf" },
				]),
			],
			[dep("mid", "root"), dep("leaf", "mid")],
			{},
		);
		const x = (id: string) => graph.positions.get(id)?.x ?? -1;
		expect(x("root")).toBeGreaterThan(x("mid"));
		expect(x("mid")).toBeGreaterThan(x("leaf"));
	});

	it("early-left preserves the 2026-07-10 board-aligned direction behind the toggle", () => {
		const graph = buildDagGraph(
			[
				col("planning", [
					{ id: "root", title: "Root" },
					{ id: "leaf", title: "Leaf" },
				]),
			],
			[dep("leaf", "root")],
			{},
			{ flowDirection: "early-left" },
		);
		const x = (id: string) => graph.positions.get(id)?.x ?? -1;
		expect(x("root")).toBeLessThan(x("leaf"));
	});

	it("barycenter ordering groups children under their parents (tree structure)", () => {
		// Two roots, each with two children; board order interleaves the children (a1, b1, a2, b2).
		// After the barycenter sweeps, a-children sit adjacent to each other, as do b-children.
		const graph = buildDagGraph(
			[
				col("planning", [
					{ id: "rootA", title: "A" },
					{ id: "rootB", title: "B" },
					{ id: "a1", title: "a1" },
					{ id: "b1", title: "b1" },
					{ id: "a2", title: "a2" },
					{ id: "b2", title: "b2" },
				]),
			],
			[dep("a1", "rootA"), dep("a2", "rootA"), dep("b1", "rootB"), dep("b2", "rootB")],
			{},
		);
		const y = (id: string) => graph.positions.get(id)?.y ?? -1;
		const aBand = [y("a1"), y("a2")].sort((p, q) => p - q) as [number, number];
		const bBand = [y("b1"), y("b2")].sort((p, q) => p - q) as [number, number];
		const disjoint = aBand[1] < bBand[0] || bBand[1] < aBand[0];
		expect(disjoint, `a-band ${aBand} and b-band ${bBand} must not interleave`).toBe(true);
	});
});
