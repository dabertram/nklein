import { describe, expect, it } from "vitest";
import {
	composeActivityMap,
	orderRingSlots,
	resolveBubbleLabelLayout,
	UNPLANNED_CLUSTER_ID,
} from "@/components/activity-map-model";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardCard, BoardColumn } from "@/types";

const NOW = 1_000_000_000;

function card(id: string, over: Partial<BoardCard> = {}): BoardCard {
	return {
		id,
		title: id,
		prompt: "p",
		startInPlanMode: false,
		agentId: "nklein",
		baseRef: "main",
		createdAt: 1,
		updatedAt: NOW - 1_000,
		...over,
	} as BoardCard;
}

function session(
	taskId: string,
	state: RuntimeTaskSessionSummary["state"],
	lastHookAt = NOW - 10_000,
): RuntimeTaskSessionSummary {
	return {
		taskId,
		state,
		agentId: "nklein",
		workspacePath: null,
		pid: null,
		startedAt: NOW - 60_000,
		updatedAt: NOW,
		lastOutputAt: lastHookAt,
		reviewReason: null,
		exitCode: null,
		lastHookAt,
		latestHookActivity: null,
	} as RuntimeTaskSessionSummary;
}

const plan = (slug: string) => ({ artifactKind: "decomposition" as const, planSlug: slug, planTaskId: "seed" });

describe("composeActivityMap (§5.BB Zoom 0)", () => {
	const columns: BoardColumn[] = [
		{ id: "backlog", title: "Backlog", cards: [card("b1", { generatedFromPlan: plan("goal-settings") })] },
		{ id: "planning", title: "Planning", cards: [] },
		{
			id: "in_progress",
			title: "In Progress",
			cards: [
				card("run1", { generatedFromPlan: plan("trend-classification") }),
				card("held1", { generatedFromPlan: plan("trend-classification") }),
			],
		},
		{ id: "review", title: "Review", cards: [card("rev1", { generatedFromPlan: plan("goal-settings") })] },
		{ id: "completed", title: "Completed", cards: [card("done1", { updatedAt: NOW - 30 * 60_000 })] },
		{ id: "trash", title: "Trash", cards: [card("trashed")] },
	];

	it("clusters by plan slug (unplanned fallback), derives states, and counts running", () => {
		const map = composeActivityMap({
			columns,
			dependencies: [],
			sessions: { run1: session("run1", "running") },
			now: () => NOW,
		});
		expect(map.totalCards).toBe(5); // trash excluded
		expect(map.runningCount).toBe(1);
		const byId = new Map(map.clusters.map((c) => [c.id, c]));
		expect([...byId.keys()].sort()).toEqual(["goal-settings", "trend-classification", UNPLANNED_CLUSTER_ID].sort());
		const trend = byId.get("trend-classification");
		expect(trend?.runningCount).toBe(1);
		const states = Object.fromEntries(map.clusters.flatMap((c) => c.bubbles.map((b) => [b.id, b.state])));
		expect(states).toMatchObject({ run1: "running", held1: "waiting", rev1: "review", b1: "idle", done1: "done" });
	});

	it("recent activity boosts bubble size; done cards fade with age", () => {
		const map = composeActivityMap({
			columns,
			dependencies: [],
			sessions: { run1: session("run1", "running", NOW - 5_000) },
			now: () => NOW,
		});
		const bubbles = new Map(map.clusters.flatMap((c) => c.bubbles.map((b) => [b.id, b])));
		expect((bubbles.get("run1")?.radius ?? 0) > 20).toBe(true); // base 20 + boost
		expect(bubbles.get("run1")?.pulsing).toBe(true);
		expect((bubbles.get("done1")?.fade ?? 0) > 0.4).toBe(true); // 30min into a 60min fade
	});

	it("marks cross-cluster dependency edges and drops edges to trashed cards", () => {
		const map = composeActivityMap({
			columns,
			dependencies: [
				{ id: "d1", fromTaskId: "rev1", toTaskId: "run1", createdAt: 1 }, // goal ← trend (cross)
				{ id: "d2", fromTaskId: "held1", toTaskId: "run1", createdAt: 1 }, // within trend
				{ id: "d3", fromTaskId: "trashed", toTaskId: "run1", createdAt: 1 }, // trash → dropped
			],
			sessions: {},
			now: () => NOW,
		});
		expect(map.edges).toHaveLength(2);
		expect(map.edges.find((e) => e.fromCardId === "rev1")?.crossCluster).toBe(true);
		expect(map.edges.find((e) => e.fromCardId === "held1")?.crossCluster).toBe(false);
	});
});

describe("label density", () => {
	it("keeps all labels on small boards but only active labels in a crowded cluster", () => {
		const smallColumns: BoardColumn[] = [{ id: "planning", title: "Planning", cards: [card("a"), card("b")] }];
		const small = composeActivityMap({ columns: smallColumns, dependencies: [], sessions: {}, now: () => NOW });
		expect(small.clusters.flatMap((cluster) => cluster.bubbles).every((bubble) => bubble.showLabel)).toBe(true);

		const manyCards = Array.from({ length: 30 }, (_, index) => card(`c${index}`));
		const busyColumns: BoardColumn[] = [
			{ id: "planning", title: "Planning", cards: manyCards },
			{ id: "in_progress", title: "In progress", cards: [card("hot")] },
		];
		const busy = composeActivityMap({
			columns: busyColumns,
			dependencies: [],
			sessions: { hot: session("hot", "running") },
			now: () => NOW,
		});
		const bubbles = busy.clusters.flatMap((cluster) => cluster.bubbles);
		const hot = bubbles.find((bubble) => bubble.id === "hot");
		expect(hot?.showLabel).toBe(true);
		const idle = bubbles.filter((bubble) => bubble.id !== "hot");
		expect(idle.some((bubble) => bubble.showLabel)).toBe(false);
	});

	it("declutters a single dense cluster even when the board total is small (per-cluster trigger)", () => {
		// 12 done cards, all one stream ⇒ one cluster of 12. Total is well under any board-wide limit, but the
		// captions still pile up — this is the all-done single-stream project that stacked 18 unreadable labels.
		const cards = Array.from({ length: 12 }, (_, index) =>
			card(`d${index}`, { generatedFromPlan: plan("safety-stream") }),
		);
		const columns: BoardColumn[] = [{ id: "completed", title: "Completed", cards }];
		const map = composeActivityMap({ columns, dependencies: [], sessions: {}, now: () => NOW });
		const bubbles = map.clusters.flatMap((cluster) => cluster.bubbles);
		expect(bubbles.length).toBe(12);
		// No active bubbles ⇒ the dense cluster shows zero inline labels (halo label + hover still identify them).
		expect(bubbles.some((bubble) => bubble.showLabel)).toBe(false);
	});

	it("keeps labels when many cards are spread across small clusters (no false board-wide declutter)", () => {
		// 30 cards, but six streams of five ⇒ every cluster is sparse. A board-wide count would wrongly strip these;
		// per-cluster keeps them because five captions in a halo do not collide.
		const cards = Array.from({ length: 6 }, (_, s) =>
			Array.from({ length: 5 }, (_, i) => card(`s${s}-c${i}`, { generatedFromPlan: plan(`stream-${s}`) })),
		).flat();
		const columns: BoardColumn[] = [{ id: "completed", title: "Completed", cards }];
		const map = composeActivityMap({ columns, dependencies: [], sessions: {}, now: () => NOW });
		const bubbles = map.clusters.flatMap((cluster) => cluster.bubbles);
		expect(bubbles.length).toBe(30);
		expect(bubbles.every((bubble) => bubble.showLabel)).toBe(true);
	});
});

describe("resolveBubbleLabelLayout", () => {
	const bubble = (id: string, x: number, y: number, caption: string, preferAbove = false) => ({
		id,
		x,
		y,
		radius: 14,
		caption,
		preferAbove,
	});

	it("keeps non-colliding labels on their preferred side", () => {
		const layout = resolveBubbleLabelLayout(
			[bubble("a", 100, 100, "Alpha"), bubble("b", 400, 100, "Beta", true)],
			800,
		);
		expect(layout.get("a")).toEqual({ above: false, hidden: false });
		expect(layout.get("b")).toEqual({ above: true, hidden: false });
	});

	it("flips the second label to the other side when both prefer the same line (the overprint case)", () => {
		// Same y, close x, both prefer below → their below-rects overlap → b flips above.
		const layout = resolveBubbleLabelLayout(
			[bubble("a", 100, 100, "Expand tests for allocation"), bubble("b", 150, 100, "Document model analysis")],
			800,
		);
		expect(layout.get("a")).toEqual({ above: false, hidden: false });
		expect(layout.get("b")).toEqual({ above: true, hidden: false });
	});

	it("hides a label when both sides would overprint already-placed labels", () => {
		// Both blockers sit ABOVE c (placed first in reading order) and their below-labels occupy exactly the two
		// lines c could use: blocker1's rect (y≈98–110) covers c's above line, blocker2's (y≈141–153) c's below line.
		const layout = resolveBubbleLabelLayout(
			[
				bubble("blocker1", 100, 76, "First long caption text"),
				bubble("blocker2", 120, 124, "Second long caption text"),
				bubble("c", 110, 128, "Sandwiched caption text"),
			],
			800,
		);
		expect(layout.get("blocker1")?.hidden).toBe(false);
		expect(layout.get("blocker2")?.hidden).toBe(false);
		expect(layout.get("c")?.hidden).toBe(true);
	});

	it("is deterministic regardless of input order (reading-order placement)", () => {
		const set = [bubble("a", 100, 100, "Caption one"), bubble("b", 140, 100, "Caption two")];
		const forward = resolveBubbleLabelLayout(set, 800);
		const reversed = resolveBubbleLabelLayout([...set].reverse(), 800);
		expect(forward.get("a")).toEqual(reversed.get("a"));
		expect(forward.get("b")).toEqual(reversed.get("b"));
	});

	it("accounts for edge clamping when computing collision rects", () => {
		// Two bubbles hugging the left edge: their clamped label rects overlap even though raw x differs.
		const layout = resolveBubbleLabelLayout(
			[bubble("a", 2, 100, "Edge hugging caption"), bubble("b", 30, 100, "Another edge caption")],
			800,
		);
		expect(layout.get("b")?.above).toBe(true); // flipped, not overprinted
	});
});

describe("active-center ordering (F2.33 companion, 2026-09-03)", () => {
	it("sorts each cluster running-first so actives claim the inner ring, done drifts outward", () => {
		const columns = [
			{
				id: "planning",
				title: "Planning",
				cards: [
					{ id: "idle-1", title: "Idle 1", updatedAt: 0 },
					{ id: "run-1", title: "Running 1", updatedAt: 0 },
					{ id: "idle-2", title: "Idle 2", updatedAt: 0 },
				],
			},
			{ id: "completed", title: "Done", cards: [{ id: "done-1", title: "Done 1", updatedAt: 0 }] },
			{ id: "review", title: "Review", cards: [{ id: "rev-1", title: "Review 1", updatedAt: 0 }] },
		] as never;
		const map = composeActivityMap({
			columns,
			dependencies: [],
			sessions: { "run-1": { taskId: "run-1", state: "running" } } as never,
			now: () => 1_000_000,
		});
		const cluster = map.clusters.find((entry) => entry.bubbles.length === 5);
		expect(cluster, "all five cards share the unplanned cluster").toBeTruthy();
		const order = (cluster?.bubbles ?? []).map((bubble) => bubble.id);
		expect(order[0]).toBe("run-1"); // running claims the center slot
		expect(order[1]).toBe("rev-1"); // review next
		expect(order[order.length - 1]).toBe("done-1"); // done drifts outermost
		// Stable within a state: idle cards keep their board order.
		expect(order.indexOf("idle-1")).toBeLessThan(order.indexOf("idle-2"));
	});
});

describe("orderRingSlots (David 2026-09-04: minimize overlapping edges in the clean view)", () => {
	it("keeps ring MEMBERSHIP in array order (state ranking) while reordering within rings by connectivity", () => {
		const ids = ["r0", "r1", "r2", "r3", "r4", "r5", "o0", "o1", "o2", "o3"];
		const neighbors = new Map<string, string[]>([
			["o3", ["r0"]],
			["r0", ["o3"]],
			["o0", ["r5"]],
			["r5", ["o0"]],
		]);
		const slots = orderRingSlots(ids, [6, 4], neighbors);
		for (const id of ids.slice(0, 6)) {
			expect(slots.get(id)?.ring).toBe(0);
		}
		for (const id of ids.slice(6)) {
			expect(slots.get(id)?.ring).toBe(1);
		}
		// Connected outer bubbles sit at the angular fraction closest to their inner neighbor.
		const fraction = (id: string): number => {
			const slot = slots.get(id);
			return slot ? slot.indexInRing / slot.ringSize : Number.NaN;
		};
		const circular = (a: number, b: number): number => {
			const raw = Math.abs(a - b) % 1;
			return Math.min(raw, 1 - raw);
		};
		expect(circular(fraction("o3"), fraction("r0"))).toBeLessThanOrEqual(0.25);
		expect(circular(fraction("o0"), fraction("r5"))).toBeLessThanOrEqual(0.25);
	});

	it("is deterministic and assigns every bubble exactly one slot", () => {
		const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
		const neighbors = new Map<string, string[]>([["h", ["a"]]]);
		const first = orderRingSlots(ids, [6, 2], neighbors);
		const second = orderRingSlots(ids, [6, 2], neighbors);
		expect([...first.entries()]).toEqual([...second.entries()]);
		expect(first.size).toBe(ids.length);
		const slotKeys = new Set([...first.values()].map((slot) => `${slot.ring}:${slot.indexInRing}`));
		expect(slotKeys.size).toBe(ids.length);
	});
});
