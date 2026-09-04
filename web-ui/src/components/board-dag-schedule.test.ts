import { describe, expect, it } from "vitest";
import {
	computeDagSchedule,
	DEFAULT_ESTIMATE_MS,
	DIFFICULTY_ESTIMATE_MS,
	formatDurationShort,
	formatEtaClock,
} from "@/components/board-dag-schedule";
import type { BoardDependency } from "@/types";

function dep(from: string, to: string): BoardDependency {
	return { id: `${from}->${to}`, fromTaskId: from, toTaskId: to, createdAt: 0 };
}

const NOW = 1_700_000_000_000;

describe("computeDagSchedule (David 2026-09-04: durations, ETAs, critical path)", () => {
	it("uses observed time for done cards, labels for open ones, and finds the longest remaining chain", () => {
		// root (done, observed 10m) ← mid (hard, open) ← leaf (easy, open); side (medium, open) also ← root.
		const nodes = [
			{ id: "root", columnId: "completed", running: false },
			{ id: "mid", columnId: "planning", running: false },
			{ id: "leaf", columnId: "planning", running: false },
			{ id: "side", columnId: "planning", running: false },
		];
		const edges = [dep("mid", "root"), dep("leaf", "mid"), dep("side", "root")];
		const facts = new Map([
			["root", { observedMs: 10 * 60_000, difficulty: "easy", lastCompletedAt: NOW - 1000 }],
			["mid", { observedMs: null, difficulty: "hard", lastCompletedAt: null }],
			["leaf", { observedMs: null, difficulty: "easy", lastCompletedAt: null }],
			["side", { observedMs: null, difficulty: "medium", lastCompletedAt: null }],
		]);
		const schedule = computeDagSchedule({ nodes, edges, facts, sessionStartedAt: new Map(), now: NOW });
		const root = schedule.byNodeId.get("root");
		expect(root?.estimated).toBe(false);
		expect(root?.remainingMs).toBe(0);
		expect(root?.etaAt).toBeNull();
		const mid = schedule.byNodeId.get("mid");
		expect(mid?.estimateMs).toBe(DIFFICULTY_ESTIMATE_MS.hard);
		expect(mid?.finishOffsetMs).toBe(DIFFICULTY_ESTIMATE_MS.hard);
		const leaf = schedule.byNodeId.get("leaf");
		expect(leaf?.finishOffsetMs).toBe((DIFFICULTY_ESTIMATE_MS.hard ?? 0) + (DIFFICULTY_ESTIMATE_MS.easy ?? 0));
		expect(leaf?.etaAt).toBe(NOW + (leaf?.finishOffsetMs ?? 0));
		// Critical path = the longest REMAINING chain (mid → leaf); the finished root contributes no remaining
		// work and stays off it, and the shorter side branch never makes it.
		expect([...schedule.criticalNodeIds].sort()).toEqual(["leaf", "mid"]);
		expect([...schedule.criticalEdgeIds].sort()).toEqual(["leaf->mid"]);
		expect(schedule.byNodeId.get("side")?.onCriticalPath).toBe(false);
		expect(schedule.boardFinishOffsetMs).toBe(leaf?.finishOffsetMs);
		expect(schedule.estimateBasis).toBe("observed-median");
	});

	it("a running card's remaining time shrinks with elapsed but never below 15% of its estimate", () => {
		const nodes = [{ id: "a", columnId: "in_progress", running: true }];
		const facts = new Map([["a", { observedMs: null, difficulty: "medium", lastCompletedAt: null }]]);
		const fresh = computeDagSchedule({
			nodes,
			edges: [],
			facts,
			sessionStartedAt: new Map([["a", NOW - 5 * 60_000]]),
			now: NOW,
		});
		expect(fresh.byNodeId.get("a")?.remainingMs).toBe((DIFFICULTY_ESTIMATE_MS.medium ?? 0) - 5 * 60_000);
		expect(fresh.byNodeId.get("a")?.elapsedMs).toBe(5 * 60_000);
		const overrun = computeDagSchedule({
			nodes,
			edges: [],
			facts,
			sessionStartedAt: new Map([["a", NOW - 3 * 60 * 60_000]]),
			now: NOW,
		});
		expect(overrun.byNodeId.get("a")?.remainingMs).toBe((DIFFICULTY_ESTIMATE_MS.medium ?? 0) * 0.15);
	});

	it("falls back to the board's observed median, then to the default, and is cycle-safe", () => {
		const nodes = [
			{ id: "d1", columnId: "completed", running: false },
			{ id: "d2", columnId: "completed", running: false },
			{ id: "open", columnId: "planning", running: false },
		];
		const facts = new Map([
			["d1", { observedMs: 4 * 60_000, difficulty: null, lastCompletedAt: NOW }],
			["d2", { observedMs: 8 * 60_000, difficulty: null, lastCompletedAt: NOW }],
		]);
		const withMedian = computeDagSchedule({ nodes, edges: [], facts, sessionStartedAt: new Map(), now: NOW });
		expect(withMedian.byNodeId.get("open")?.estimateMs).toBe(6 * 60_000);
		expect(withMedian.estimateBasis).toBe("observed-median");
		const bare = computeDagSchedule({
			nodes: [{ id: "x", columnId: "planning", running: false }],
			edges: [],
			facts: new Map(),
			sessionStartedAt: new Map(),
			now: NOW,
		});
		expect(bare.byNodeId.get("x")?.estimateMs).toBe(DEFAULT_ESTIMATE_MS);
		expect(bare.estimateBasis).toBe("defaults");
		const cyclic = computeDagSchedule({
			nodes: [
				{ id: "a", columnId: "planning", running: false },
				{ id: "b", columnId: "planning", running: false },
			],
			edges: [dep("a", "b"), dep("b", "a")],
			facts: new Map(),
			sessionStartedAt: new Map(),
			now: NOW,
		});
		expect(cyclic.byNodeId.size).toBe(2);
		expect(cyclic.boardFinishOffsetMs).toBeGreaterThan(0);
	});

	it("formats durations and ETAs compactly", () => {
		expect(formatDurationShort(45_000)).toBe("45s");
		expect(formatDurationShort(12 * 60_000)).toBe("12m");
		expect(formatDurationShort(65 * 60_000)).toBe("1h05");
		expect(formatDurationShort(27 * 60 * 60_000)).toBe("1d3h");
		const now = new Date(2026, 8, 4, 10, 0, 0).getTime();
		expect(formatEtaClock(now + 42 * 60_000, now)).toBe("10:42");
		expect(formatEtaClock(now + 26 * 60 * 60_000, now)).toMatch(/^\w{3} 12:00$/u);
	});
});
