import { describe, expect, it } from "vitest";
import {
	type DurableHeartbeatSessionView,
	resolveDurableHeartbeatTaskIds,
} from "../../../src/core/durable-lease-heartbeat";

const session = (taskId: string, state: DurableHeartbeatSessionView["state"]): DurableHeartbeatSessionView => ({
	taskId,
	state,
});

describe("resolveDurableHeartbeatTaskIds (G6.8a v16 — leases reclaimed off healthy cards)", () => {
	it("heartbeats a card whose START IS QUEUED with no session at all — the v16 regression", () => {
		// `habit-score-clamping-tests-clamping` held a durable lease while its start sat in the task-start queue
		// behind a busy endpoint for 27 minutes. `endpoint_busy` returns `summary: null`, so the card had NOTHING
		// in listSummaries() — the old `state === "running"` filter saw an empty set, the lease was reclaimed three
		// times, and max_attempts cancelled a card that started for real eleven minutes later.
		const live = resolveDurableHeartbeatTaskIds({
			sessions: [],
			queuedStartTaskIds: ["habit-score-clamping-tests-clamping"],
		});
		expect(live).toEqual(["habit-score-clamping-tests-clamping"]);
	});

	it("heartbeats a session queued in model-turn admission (waiting its turn is not being dead)", () => {
		expect(resolveDurableHeartbeatTaskIds({ sessions: [session("a", "queued")], queuedStartTaskIds: [] })).toEqual([
			"a",
		]);
	});

	it("heartbeats a card under review — reviews outlive the 5-minute lease", () => {
		// v16 reviews ran ~10 minutes. Reclaiming here would re-dispatch a card while its reviewer was still working.
		expect(
			resolveDurableHeartbeatTaskIds({ sessions: [session("a", "awaiting_review")], queuedStartTaskIds: [] }),
		).toEqual(["a"]);
	});

	it("heartbeats a paused session (deliberately held, not dead)", () => {
		expect(resolveDurableHeartbeatTaskIds({ sessions: [session("a", "paused")], queuedStartTaskIds: [] })).toEqual([
			"a",
		]);
	});

	it("does NOT heartbeat terminal or absent sessions — a genuinely dead worker must still be reclaimed", () => {
		const live = resolveDurableHeartbeatTaskIds({
			sessions: [session("dead", "failed"), session("gone", "interrupted"), session("nothing", "idle")],
			queuedStartTaskIds: [],
		});
		expect(live).toEqual([]);
	});

	it("unions both populations without duplicating a card that is both queued and session-bearing", () => {
		const live = resolveDurableHeartbeatTaskIds({
			sessions: [session("a", "running"), session("b", "failed"), session("c", "awaiting_review")],
			queuedStartTaskIds: ["a", "d"],
		});
		expect([...live].sort()).toEqual(["a", "c", "d"]);
	});

	it("returns an empty set when nothing is alive (the tick may reclaim freely)", () => {
		expect(resolveDurableHeartbeatTaskIds({ sessions: [], queuedStartTaskIds: [] })).toEqual([]);
	});
});
