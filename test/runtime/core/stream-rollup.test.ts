import { describe, expect, it } from "vitest";
import type { OperatorTaskSignals } from "../../../src/core/operator-task-state";
import { deriveStreamRollup, type StreamRollupMember } from "../../../src/core/stream-rollup";

function signals(over: Partial<OperatorTaskSignals> = {}): OperatorTaskSignals {
	return {
		sessionState: "running",
		columnId: "in_progress",
		paused: false,
		heartbeatLost: false,
		blockedKind: null,
		awaitingHostActionAck: false,
		deliveryGateHeld: false,
		clarifyingQuestionPending: false,
		noProgressOrLoop: false,
		approachingBudgetCeiling: false,
		...over,
	};
}

const NOW = 1_000_000;
const member = (taskId: string, s: Partial<OperatorTaskSignals>, lastActivityAt = NOW): StreamRollupMember => ({
	taskId,
	signals: signals(s),
	lastActivityAt,
});

const roll = (members: StreamRollupMember[], stalenessMs = 60_000) =>
	deriveStreamRollup({ members, now: NOW, stalenessMs });

describe("deriveStreamRollup", () => {
	it("an empty stream is `empty` / GC-eligible", () => {
		const r = roll([]);
		expect(r.health).toBe("empty");
		expect(r.lifecycle).toBe("empty");
		expect(r.progress).toEqual({ done: 0, total: 0, method: "card_count" });
	});

	it("counts, count-based progress, and the running frontier", () => {
		const r = roll([
			member("a", { columnId: "review", sessionState: "awaiting_review" }), // done
			member("b", { sessionState: "running" }), // healthy + frontier
			member("c", { sessionState: "running" }), // healthy + frontier
		]);
		expect(r.counts).toMatchObject({ done: 1, healthy: 2 });
		expect(r.progress).toEqual({ done: 1, total: 3, method: "card_count" });
		expect(r.frontierTaskIds).toEqual(["b", "c"]);
		expect(r.lifecycle).toBe("active");
	});

	it("the WORST live signal wins: a blocked member reads `blocked` even at 90% done", () => {
		const members = [
			...Array.from({ length: 9 }, (_, i) => member(`d${i}`, { columnId: "completed" })), // 9 done
			member("x", { deliveryGateHeld: true }), // 1 risky (ASK-blocked)
		];
		const r = roll(members);
		expect(r.progress.done).toBe(9);
		expect(r.health).toBe("blocked");
	});

	it("`at_risk` when a member is stuck (no blocking ASK)", () => {
		expect(roll([member("a", { columnId: "completed" }), member("b", { heartbeatLost: true })]).health).toBe(
			"at_risk",
		);
	});

	it("`done` when every member is terminal", () => {
		const r = roll([
			member("a", { columnId: "completed" }),
			member("b", { columnId: "review", sessionState: "awaiting_review" }),
		]);
		expect(r.lifecycle).toBe("done");
		expect(r.health).toBe("done");
	});

	it("`stale` (never false-green on_track) when an active stream has had no recent activity", () => {
		const r = roll([member("a", { sessionState: "running" }, NOW - 120_000)], 60_000);
		expect(r.stale).toBe(true);
		expect(r.health).toBe("stale");
	});

	it("`on_track` when active + recently updated + nothing wrong", () => {
		const r = roll([member("a", { sessionState: "running" }, NOW - 1_000)], 60_000);
		expect(r.stale).toBe(false);
		expect(r.health).toBe("on_track");
	});

	it("a completed stream is not marked stale even if quiet for a long time", () => {
		const r = roll([member("a", { columnId: "completed" }, NOW - 10_000_000)], 60_000);
		expect(r.stale).toBe(false);
		expect(r.health).toBe("done");
	});
});
