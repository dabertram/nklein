import type { RuntimeTaskSessionSummary } from "@runtime-contract";
import { describe, expect, it } from "vitest";
import {
	buildDagGraph,
	computeDepths,
	dagNodeHeight,
	findCycleEdgeIds,
	wrapDagTitle,
} from "@/components/board-dag-model";
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

describe("buildDagGraph — overlap minimization (David 2026-09-04)", () => {
	const sessions: Record<string, RuntimeTaskSessionSummary> = {};

	/** Count crossings between adjacent-layer edge pairs from the laid-out positions (straight segments). */
	function countCrossings(graph: ReturnType<typeof buildDagGraph>): number {
		const segments = graph.edges.flatMap((edge) => {
			const route = graph.edgeRoutes.get(edge.id) ?? [];
			const from = graph.positions.get(edge.toTaskId);
			const to = graph.positions.get(edge.fromTaskId);
			if (!from || !to) {
				return [];
			}
			const points = [from, ...route, to];
			return points.slice(1).map((point, index) => ({ a: points[index] ?? point, b: point }));
		});
		let crossings = 0;
		for (let i = 0; i < segments.length; i += 1) {
			for (let j = i + 1; j < segments.length; j += 1) {
				const s = segments[i];
				const t = segments[j];
				if (!s || !t) {
					continue;
				}
				// Same-span segments cross when their y-order flips between the two x columns.
				const sameSpan = Math.abs(s.a.x - t.a.x) < 1 && Math.abs(s.b.x - t.b.x) < 1;
				if (sameSpan && Math.sign(s.a.y - t.a.y) * Math.sign(s.b.y - t.b.y) < 0) {
					crossings += 1;
				}
			}
		}
		return crossings;
	}

	it("orders layers so a permuted 2-layer bipartite chain has zero crossings", () => {
		// Board order deliberately scrambles the dependents: a1..a4 blockers; b's depend crosswise.
		const columns = [column("backlog", ["b3", "b1", "b4", "b2", "a1", "a2", "a3", "a4"])];
		const deps = [dep("b1", "a1"), dep("b2", "a2"), dep("b3", "a3"), dep("b4", "a4")];
		const graph = buildDagGraph(columns, deps, sessions);
		expect(countCrossings(graph)).toBe(0);
	});

	it("routes an edge spanning several layers through waypoints in every intermediate layer", () => {
		// r → m1 → m2 → leaf, plus a long edge leaf → r (depth 0 → depth 3): 2 waypoints (depths 1 and 2).
		const columns = [column("backlog", ["r", "m1", "m2", "leaf"])];
		const deps = [dep("m1", "r"), dep("m2", "m1"), dep("leaf", "m2"), dep("leaf", "r")];
		const graph = buildDagGraph(columns, deps, sessions, { flowDirection: "early-left" });
		const route = graph.edgeRoutes.get("leaf->r");
		expect(route).toHaveLength(2);
		const xs = (route ?? []).map((point) => point.x);
		const columnX = (id: string): number => graph.positions.get(id)?.x ?? Number.NaN;
		// Waypoints sit centered inside the intermediate columns, strictly between the endpoints.
		expect(xs[0]).toBeGreaterThan(columnX("r"));
		expect(xs[1]).toBeGreaterThan(xs[0] ?? 0);
		expect(xs[1]).toBeLessThan(columnX("leaf"));
		// Adjacent-layer edges get no route.
		expect(graph.edgeRoutes.has("m1->r")).toBe(false);
	});

	it("keeps virtual corridors out of node positions and is deterministic", () => {
		const columns = [column("backlog", ["r", "m1", "m2", "leaf", "x"])];
		const deps = [dep("m1", "r"), dep("m2", "m1"), dep("leaf", "m2"), dep("leaf", "r"), dep("x", "r")];
		const first = buildDagGraph(columns, deps, sessions);
		const second = buildDagGraph(columns, deps, sessions);
		expect([...first.positions.entries()]).toEqual([...second.positions.entries()]);
		expect([...first.edgeRoutes.entries()]).toEqual([...second.edgeRoutes.entries()]);
		// Every real node still has a position; no node shares a slot with another in its column.
		const seen = new Set<string>();
		for (const [, position] of first.positions) {
			const key = `${position.x}:${position.y}`;
			expect(seen.has(key)).toBe(false);
			seen.add(key);
		}
	});
});

describe("wrapped titles + per-node heights (David 2026-09-05: no truncation in DAG cards)", () => {
	it("word-wraps to the node width, hard-splits over-long words, and never drops text", () => {
		expect(wrapDagTitle("short")).toEqual(["short"]);
		expect(wrapDagTitle("S44a production system clock single wall-clock file", 22)).toEqual([
			"S44a production system",
			"clock single",
			"wall-clock file",
		]);
		expect(wrapDagTitle("a".repeat(50), 22)).toEqual(["a".repeat(22), "a".repeat(22), "a".repeat(6)]);
		expect(dagNodeHeight(1)).toBe(44);
		expect(dagNodeHeight(3)).toBe(44 + 2 * 13);
	});

	it("stacks a layer by each node's own height", () => {
		const columns = [
			{
				id: "planning",
				title: "Planning",
				cards: [
					{ id: "tall", title: "a very long title that wraps onto three separate lines for sure", prompt: "" },
					{ id: "next", title: "next", prompt: "" },
				],
			},
		] as never;
		const graph = buildDagGraph(columns, [], {});
		expect(graph.titleLines.get("tall")?.length).toBeGreaterThan(1);
		const tallHeight = graph.nodeHeights.get("tall") ?? 0;
		expect(tallHeight).toBeGreaterThan(44);
		const tall = graph.positions.get("tall");
		const next = graph.positions.get("next");
		expect((next?.y ?? 0) - (tall?.y ?? 0)).toBe(tallHeight + 18);
	});
});
