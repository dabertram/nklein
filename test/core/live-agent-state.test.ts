import { describe, expect, it } from "vitest";
import {
	classifyLiveAgentState,
	type LiveAgentStateSignals,
	livenessThresholdsForDifficulty,
	openDependencyBlockers,
} from "../../src/core/live-agent-state";

const NOW = 1_800_000_000_000;

function signals(overrides: Partial<LiveAgentStateSignals>): LiveAgentStateSignals {
	return {
		sessionState: null,
		columnId: "in_progress",
		waitingForOperator: false,
		blockedOnDependency: false,
		nowMs: NOW,
		lastActivityAtMs: NOW - 5_000,
		heartbeatStatus: "healthy",
		difficultyTier: null,
		...overrides,
	};
}

describe("classifyLiveAgentState (F12.51)", () => {
	it("never lets waiting-for-approval masquerade as idle", () => {
		const verdict = classifyLiveAgentState(signals({ sessionState: "idle", waitingForOperator: true }));
		expect(verdict.state).toBe("waiting_for_approval");
		expect(verdict.reason).toContain("YOU");
	});

	it("classifies an actively-emitting run as working", () => {
		expect(classifyLiveAgentState(signals({ sessionState: "running" })).state).toBe("working");
	});

	it("auto-flips working→stuck past the difficulty-scaled window", () => {
		const quiet = signals({ sessionState: "running", lastActivityAtMs: NOW - 400_000 });
		expect(classifyLiveAgentState(quiet).state).toBe("stuck");
		// The same quiet gap on a HARD task is still within its 4× window → working.
		expect(classifyLiveAgentState({ ...quiet, difficultyTier: "hard" }).state).toBe("working");
	});

	it("flags a lost heartbeat as stuck with a dead-run reason", () => {
		const verdict = classifyLiveAgentState(signals({ sessionState: "running", heartbeatStatus: "lost" }));
		expect(verdict.state).toBe("stuck");
		expect(verdict.reason).toContain("Heartbeat");
	});

	it("treats a STALE heartbeat as degraded, never as freshly-beating (review-found)", () => {
		const verdict = classifyLiveAgentState(signals({ sessionState: "running", heartbeatStatus: "stale" }));
		expect(verdict.state).toBe("stuck");
	});

	it("distinguishes blocked-on-dependency from plain idle", () => {
		expect(classifyLiveAgentState(signals({ sessionState: null, blockedOnDependency: true })).state).toBe(
			"blocked_on_dependency",
		);
		expect(classifyLiveAgentState(signals({ sessionState: null })).state).toBe("idle");
	});

	it("maps terminal lanes and failed runs correctly", () => {
		expect(classifyLiveAgentState(signals({ columnId: "completed" })).state).toBe("done");
		expect(classifyLiveAgentState(signals({ sessionState: "awaiting_review" })).state).toBe("done");
		expect(classifyLiveAgentState(signals({ sessionState: "failed" })).state).toBe("stuck");
		expect(classifyLiveAgentState(signals({ sessionState: "queued" })).state).toBe("idle");
	});
});

describe("openDependencyBlockers (F12.51)", () => {
	it("returns only unresolved upstream tasks, ignoring settled and deleted ones", () => {
		const columns = new Map([
			["up-open", "in_progress"],
			["up-done", "completed"],
			["up-trash", "trash"],
		]);
		// Board edge semantics: from DEPENDS ON to — "t" waiting on upstream is {fromTaskId: "t", toTaskId: upstream}.
		const edges = [
			{ fromTaskId: "t", toTaskId: "up-open" },
			{ fromTaskId: "t", toTaskId: "up-done" },
			{ fromTaskId: "t", toTaskId: "up-trash" },
			{ fromTaskId: "t", toTaskId: "up-deleted" },
			{ fromTaskId: "other", toTaskId: "up-open" },
			// A dependent waiting ON "t" must never mark "t" itself blocked (the pre-fix inversion did).
			{ fromTaskId: "downstream", toTaskId: "t" },
		];
		expect(openDependencyBlockers("t", edges, columns)).toEqual(["up-open"]);
	});
});

describe("livenessThresholdsForDifficulty (F12.51)", () => {
	it("stretches only the stall window, never the heartbeat-loss window", () => {
		const easy = livenessThresholdsForDifficulty("easy");
		const hard = livenessThresholdsForDifficulty("hard");
		expect(hard.stalledAfterMs).toBe(easy.stalledAfterMs * 4);
		expect(hard.heartbeatLostAfterMs).toBe(easy.heartbeatLostAfterMs);
	});
});
