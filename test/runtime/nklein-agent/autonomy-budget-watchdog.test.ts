import { describe, expect, it, vi } from "vitest";
import type {
	RuntimeSwarmGuardrails,
	RuntimeTaskSessionSummary,
	RuntimeTaskTurnCheckpoint,
} from "../../../src/core/api-contract";
import { createHomeAgentSessionId } from "../../../src/core/home-agent-session";
import {
	AutonomyBudgetWatchdog,
	type AutonomyBudgetWatchdogCallbacks,
	formatWallTimeDuration,
} from "../../../src/nklein-agent/autonomy-budget-watchdog";
import type { NKleinTaskSessionEntry } from "../../../src/nklein-agent/nklein-session-state";

const GUARDRAILS: RuntimeSwarmGuardrails = {
	maxAutonomousTurnsPerTask: 10,
	maxAutonomousWallTimeMs: 3_600_000,
	maxRepeatedNoDiffCheckpoints: 3,
	maxRepeatedToolCallsPerTask: 6,
};

function summary(over: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "t1",
		state: "running",
		agentId: "nklein",
		workspacePath: null,
		pid: null,
		startedAt: Date.now(),
		updatedAt: 0,
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		...over,
	};
}

function entry(summaryOver: Partial<RuntimeTaskSessionSummary> = {}): NKleinTaskSessionEntry {
	return {
		summary: summary(summaryOver),
		messages: [],
		activeAssistantMessageId: null,
		activeReasoningMessageId: null,
		toolMessageIdByToolCallId: new Map(),
		toolInputByToolCallId: new Map(),
	};
}

function checkpoint(over: Partial<RuntimeTaskTurnCheckpoint> = {}): RuntimeTaskTurnCheckpoint {
	return { turn: 1, ref: "refs/nklein/t1", commit: "c1", createdAt: 0, ...over };
}

/** An entry whose latest activity is a no-tool final answer with the given text (for the repeated-final-answer guard). */
function finalAnswerEntry(
	finalMessage: string,
	summaryOver: Partial<RuntimeTaskSessionSummary> = {},
): NKleinTaskSessionEntry {
	return entry({
		latestHookActivity: {
			activityText: `Final: ${finalMessage}`,
			toolName: null,
			toolInputSummary: null,
			finalMessage,
			hookEventName: "agent_end",
			notificationType: null,
			source: "nklein-sdk",
		},
		...summaryOver,
	});
}

function makeCallbacks(over: Partial<AutonomyBudgetWatchdogCallbacks> = {}): AutonomyBudgetWatchdogCallbacks {
	return {
		getSwarmGuardrails: () => GUARDRAILS,
		isTaskPaused: vi.fn(() => false),
		parkTaskForPause: vi.fn((i) => ({ ...i.entry.summary, paused: true })),
		parkTaskForAutonomyBudget: vi.fn((i) => ({ ...i.entry.summary, reviewReason: "attention" as const })),
		...over,
	};
}

describe("formatWallTimeDuration", () => {
	it("formats minutes and hours with correct pluralization (min 1 minute)", () => {
		expect(formatWallTimeDuration(0)).toBe("1 minute");
		expect(formatWallTimeDuration(60_000)).toBe("1 minute");
		expect(formatWallTimeDuration(120_000)).toBe("2 minutes");
		expect(formatWallTimeDuration(3_600_000)).toBe("1 hour");
		expect(formatWallTimeDuration(90 * 60_000)).toBe("1 hour 30 minutes");
		expect(formatWallTimeDuration(2 * 3_600_000)).toBe("2 hours");
		expect(formatWallTimeDuration(125 * 60_000)).toBe("2 hours 5 minutes");
	});
});

describe("AutonomyBudgetWatchdog.check", () => {
	it("lets a healthy checkpoint continue (returns null, parks nothing)", () => {
		const callbacks = makeCallbacks();
		expect(new AutonomyBudgetWatchdog(callbacks).check("t1", checkpoint(), entry())).toBeNull();
		expect(callbacks.parkTaskForAutonomyBudget).not.toHaveBeenCalled();
		expect(callbacks.parkTaskForPause).not.toHaveBeenCalled();
	});

	it("skips home-agent sessions and already-attention tasks", () => {
		const watchdog = new AutonomyBudgetWatchdog(makeCallbacks());
		expect(watchdog.check(createHomeAgentSessionId("ws", "nklein"), checkpoint({ turn: 999 }), entry())).toBeNull();
		expect(watchdog.check("t1", checkpoint({ turn: 999 }), entry({ reviewReason: "attention" }))).toBeNull();
	});

	it("parks for an operator pause", () => {
		const callbacks = makeCallbacks({ isTaskPaused: vi.fn(() => true) });
		const result = new AutonomyBudgetWatchdog(callbacks).check("t1", checkpoint(), entry());
		expect(callbacks.parkTaskForPause).toHaveBeenCalledOnce();
		expect(result?.paused).toBe(true);
	});

	it("parks when the turn count reaches the max-autonomous-turns limit", () => {
		const callbacks = makeCallbacks();
		new AutonomyBudgetWatchdog(callbacks).check("t1", checkpoint({ turn: 10 }), entry());
		expect(callbacks.parkTaskForAutonomyBudget).toHaveBeenCalledOnce();
		expect(vi.mocked(callbacks.parkTaskForAutonomyBudget).mock.calls[0]?.[0].message).toContain("autonomous turns");
	});

	it("parks after N consecutive no-diff (same-commit) checkpoints", () => {
		const callbacks = makeCallbacks();
		const watchdog = new AutonomyBudgetWatchdog(callbacks);
		expect(watchdog.check("t1", checkpoint({ turn: 1, commit: "same" }), entry())).toBeNull(); // count 1
		expect(watchdog.check("t1", checkpoint({ turn: 2, commit: "same" }), entry())).toBeNull(); // count 2
		watchdog.check("t1", checkpoint({ turn: 3, commit: "same" }), entry()); // count 3 → park
		expect(callbacks.parkTaskForAutonomyBudget).toHaveBeenCalledOnce();
		expect(vi.mocked(callbacks.parkTaskForAutonomyBudget).mock.calls[0]?.[0].message).toContain("no new diff commit");
	});

	it("resets the no-diff streak on a new commit and via resetTask", () => {
		const callbacks = makeCallbacks();
		const watchdog = new AutonomyBudgetWatchdog(callbacks);
		watchdog.check("t1", checkpoint({ turn: 1, commit: "a" }), entry());
		watchdog.check("t1", checkpoint({ turn: 2, commit: "b" }), entry()); // different commit → streak resets
		watchdog.resetTask("t1");
		expect(watchdog.check("t1", checkpoint({ turn: 3, commit: "a" }), entry())).toBeNull(); // back to count 1
		expect(callbacks.parkTaskForAutonomyBudget).not.toHaveBeenCalled();
	});

	// The repeated-final-answer guard (3) shares the "same commit" condition with the no-diff guard, so to test it in
	// isolation we relax no-diff well above 3 (production default is 20 vs this guard's 3 — so this guard fires first).
	const relaxedNoDiff = makeCallbacks({
		getSwarmGuardrails: () => ({ ...GUARDRAILS, maxRepeatedNoDiffCheckpoints: 20 }),
	});

	it("parks after 3 consecutive identical final answers at the same commit (finished-but-looping, §5.AA)", () => {
		const callbacks = makeCallbacks({
			getSwarmGuardrails: () => ({ ...GUARDRAILS, maxRepeatedNoDiffCheckpoints: 20 }),
		});
		const watchdog = new AutonomyBudgetWatchdog(callbacks);
		expect(watchdog.check("t1", checkpoint({ turn: 1, commit: "done" }), finalAnswerEntry("All done!"))).toBeNull();
		expect(watchdog.check("t1", checkpoint({ turn: 2, commit: "done" }), finalAnswerEntry("All done! "))).toBeNull();
		watchdog.check("t1", checkpoint({ turn: 3, commit: "done" }), finalAnswerEntry("All done!")); // count 3 → park
		expect(callbacks.parkTaskForAutonomyBudget).toHaveBeenCalledOnce();
		expect(vi.mocked(callbacks.parkTaskForAutonomyBudget).mock.calls[0]?.[0].message).toContain(
			"re-emitted the same final message",
		);
		expect(vi.mocked(callbacks.parkTaskForAutonomyBudget).mock.calls[0]?.[0].metadata.guardrail).toBe(
			"repeated_final_answer",
		);
	});

	it("does NOT park when the final message varies (different text resets the run)", () => {
		const watchdog = new AutonomyBudgetWatchdog(relaxedNoDiff);
		watchdog.check("t1", checkpoint({ turn: 1, commit: "done" }), finalAnswerEntry("Working on step 1."));
		watchdog.check("t1", checkpoint({ turn: 2, commit: "done" }), finalAnswerEntry("Working on step 2."));
		watchdog.check("t1", checkpoint({ turn: 3, commit: "done" }), finalAnswerEntry("Working on step 3."));
		expect(relaxedNoDiff.parkTaskForAutonomyBudget).not.toHaveBeenCalled();
	});

	it("does NOT park on identical final text when each turn makes a new commit (real progress)", () => {
		const callbacks = makeCallbacks();
		const watchdog = new AutonomyBudgetWatchdog(callbacks);
		watchdog.check("t1", checkpoint({ turn: 1, commit: "a" }), finalAnswerEntry("Committed."));
		watchdog.check("t1", checkpoint({ turn: 2, commit: "b" }), finalAnswerEntry("Committed."));
		watchdog.check("t1", checkpoint({ turn: 3, commit: "c" }), finalAnswerEntry("Committed."));
		expect(callbacks.parkTaskForAutonomyBudget).not.toHaveBeenCalled();
	});

	it("ignores checkpoints with no final message and resets the run via resetTask", () => {
		const callbacks = makeCallbacks();
		const watchdog = new AutonomyBudgetWatchdog(callbacks);
		watchdog.check("t1", checkpoint({ turn: 1, commit: "done" }), finalAnswerEntry("Done!"));
		watchdog.check("t1", checkpoint({ turn: 2, commit: "done" }), entry()); // no final message → run cleared
		watchdog.resetTask("t1");
		expect(watchdog.check("t1", checkpoint({ turn: 3, commit: "done" }), finalAnswerEntry("Done!"))).toBeNull(); // count 1
		expect(callbacks.parkTaskForAutonomyBudget).not.toHaveBeenCalled();
	});

	it("parks when autonomous wall time is exhausted", () => {
		const callbacks = makeCallbacks();
		// startedAt in the distant past → elapsed >> the 1h limit. New commit each call so no-diff doesn't trip first.
		const result = new AutonomyBudgetWatchdog(callbacks).check(
			"t1",
			checkpoint({ commit: "fresh" }),
			entry({ startedAt: 1 }),
		);
		expect(callbacks.parkTaskForAutonomyBudget).toHaveBeenCalledOnce();
		expect(vi.mocked(callbacks.parkTaskForAutonomyBudget).mock.calls[0]?.[0].message).toContain("wall time");
		expect(result?.reviewReason).toBe("attention");
	});
});
