import { describe, expect, it } from "vitest";
import { composeActivityMap, UNPLANNED_CLUSTER_ID } from "@/components/activity-map-model";
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
