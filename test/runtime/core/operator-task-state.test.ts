import { describe, expect, it } from "vitest";
import {
	buildOperatorBoardSummary,
	classifyOperatorTaskState,
	collectOperatorInbox,
	mapSessionSummaryToOperatorSignals,
	type OperatorTaskSignals,
} from "../../../src/core/operator-task-state";

const HEALTHY: OperatorTaskSignals = {
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
};

describe("classifyOperatorTaskState", () => {
	it("healthy = actively progressing", () => {
		expect(classifyOperatorTaskState(HEALTHY)).toBe("healthy");
		expect(classifyOperatorTaskState({ ...HEALTHY, sessionState: "queued" })).toBe("healthy");
	});

	it("done = merged (completed) or awaiting review", () => {
		expect(classifyOperatorTaskState({ ...HEALTHY, columnId: "completed" })).toBe("done");
		expect(classifyOperatorTaskState({ ...HEALTHY, columnId: "review" })).toBe("done");
		expect(classifyOperatorTaskState({ ...HEALTHY, sessionState: "awaiting_review" })).toBe("done");
	});

	it("stuck = failed/interrupted/paused/lost-heartbeat/no-progress/clarify/non-urgent-block", () => {
		expect(classifyOperatorTaskState({ ...HEALTHY, sessionState: "failed" })).toBe("stuck");
		expect(classifyOperatorTaskState({ ...HEALTHY, sessionState: "interrupted" })).toBe("stuck");
		expect(classifyOperatorTaskState({ ...HEALTHY, paused: true })).toBe("stuck");
		expect(classifyOperatorTaskState({ ...HEALTHY, heartbeatLost: true })).toBe("stuck");
		expect(classifyOperatorTaskState({ ...HEALTHY, noProgressOrLoop: true })).toBe("stuck");
		expect(classifyOperatorTaskState({ ...HEALTHY, approachingBudgetCeiling: true })).toBe("stuck");
		expect(classifyOperatorTaskState({ ...HEALTHY, clarifyingQuestionPending: true })).toBe("stuck");
		expect(classifyOperatorTaskState({ ...HEALTHY, blockedKind: "needs_decomposition" })).toBe("stuck");
	});

	it("risky = an unsafe action to ack, a held delivery, or sandbox unavailable", () => {
		expect(classifyOperatorTaskState({ ...HEALTHY, awaitingHostActionAck: true })).toBe("risky");
		expect(classifyOperatorTaskState({ ...HEALTHY, deliveryGateHeld: true })).toBe("risky");
		expect(classifyOperatorTaskState({ ...HEALTHY, blockedKind: "agent_sandbox_unavailable" })).toBe("risky");
	});

	it("RISKY outranks DONE — a held delivery on a review card needs the operator, it isn't cleanly done", () => {
		expect(classifyOperatorTaskState({ ...HEALTHY, columnId: "review", deliveryGateHeld: true })).toBe("risky");
	});

	it("RISKY outranks STUCK — sandbox-unavailable on a paused card is the urgent signal", () => {
		expect(classifyOperatorTaskState({ ...HEALTHY, paused: true, blockedKind: "agent_sandbox_unavailable" })).toBe(
			"risky",
		);
	});

	it("DONE outranks STUCK — an awaiting-review card with a lost heartbeat is still done (work finished)", () => {
		expect(classifyOperatorTaskState({ ...HEALTHY, sessionState: "awaiting_review", heartbeatLost: true })).toBe(
			"done",
		);
	});
});

describe("collectOperatorInbox", () => {
	it("groups tasks by the action they need + counts distinct tasks", () => {
		const inbox = collectOperatorInbox([
			{ taskId: "t-ack", signals: { ...HEALTHY, awaitingHostActionAck: true } },
			{ taskId: "t-clarify", signals: { ...HEALTHY, clarifyingQuestionPending: true } },
			{ taskId: "t-delivery", signals: { ...HEALTHY, deliveryGateHeld: true } },
			{ taskId: "t-blocked", signals: { ...HEALTHY, blockedKind: "agent_sandbox_unavailable" } },
			{ taskId: "t-fine", signals: HEALTHY },
		]);
		expect(inbox.unsafeActionAcks).toEqual(["t-ack"]);
		expect(inbox.clarifyingQuestions).toEqual(["t-clarify"]);
		expect(inbox.heldDeliveries).toEqual(["t-delivery"]);
		expect(inbox.blockedOnSetup).toEqual(["t-blocked"]);
		expect(inbox.total).toBe(4); // t-fine needs nothing
	});

	it("counts a task needing multiple actions once in total but in each relevant list", () => {
		const inbox = collectOperatorInbox([
			{ taskId: "t-both", signals: { ...HEALTHY, awaitingHostActionAck: true, deliveryGateHeld: true } },
		]);
		expect(inbox.unsafeActionAcks).toEqual(["t-both"]);
		expect(inbox.heldDeliveries).toEqual(["t-both"]);
		expect(inbox.total).toBe(1);
	});

	it("is empty when nothing needs the operator", () => {
		const inbox = collectOperatorInbox([{ taskId: "ok", signals: HEALTHY }]);
		expect(inbox.total).toBe(0);
		expect(inbox.unsafeActionAcks).toEqual([]);
	});
});

describe("mapSessionSummaryToOperatorSignals", () => {
	it("passes state + column through and derives paused/heartbeatLost from the summary", () => {
		const signals = mapSessionSummaryToOperatorSignals(
			{ state: "running", paused: true, heartbeatStatus: "lost" },
			"in_progress",
		);
		expect(signals.sessionState).toBe("running");
		expect(signals.columnId).toBe("in_progress");
		expect(signals.paused).toBe(true);
		expect(signals.heartbeatLost).toBe(true);
	});

	it("defaults the non-summary signals to safe 'not blocking' values", () => {
		const signals = mapSessionSummaryToOperatorSignals({ state: "running" }, "in_progress");
		expect(signals).toMatchObject({
			paused: false,
			heartbeatLost: false, // undefined heartbeatStatus
			blockedKind: null,
			awaitingHostActionAck: false,
			deliveryGateHeld: false,
			clarifyingQuestionPending: false,
			noProgressOrLoop: false,
			approachingBudgetCeiling: false,
		});
	});

	it("only treats a 'lost' heartbeat as lost (healthy/stale/null are fine)", () => {
		for (const heartbeatStatus of ["healthy", "stale", null, undefined] as const) {
			expect(
				mapSessionSummaryToOperatorSignals({ state: "running", heartbeatStatus }, "in_progress").heartbeatLost,
			).toBe(false);
		}
	});

	it("applies caller-supplied overrides for the off-summary signals", () => {
		const signals = mapSessionSummaryToOperatorSignals({ state: "running" }, "in_progress", {
			deliveryGateHeld: true,
			blockedKind: "agent_sandbox_unavailable",
		});
		expect(signals.deliveryGateHeld).toBe(true);
		expect(signals.blockedKind).toBe("agent_sandbox_unavailable");
	});

	it("threads the approachingBudgetCeiling override (defaults false) → a nearing-ceiling run reads stuck", () => {
		expect(mapSessionSummaryToOperatorSignals({ state: "running" }, "in_progress").approachingBudgetCeiling).toBe(
			false,
		);
		const signals = mapSessionSummaryToOperatorSignals({ state: "running" }, "in_progress", {
			approachingBudgetCeiling: true,
		});
		expect(signals.approachingBudgetCeiling).toBe(true);
		expect(classifyOperatorTaskState(signals)).toBe("stuck");
	});

	it("composes with the classifier: summary-only → healthy/stuck/done, overrides → risky", () => {
		expect(classifyOperatorTaskState(mapSessionSummaryToOperatorSignals({ state: "running" }, "in_progress"))).toBe(
			"healthy",
		);
		expect(
			classifyOperatorTaskState(
				mapSessionSummaryToOperatorSignals({ state: "running", heartbeatStatus: "lost" }, "in_progress"),
			),
		).toBe("stuck");
		expect(classifyOperatorTaskState(mapSessionSummaryToOperatorSignals({ state: "running" }, "completed"))).toBe(
			"done",
		);
		expect(
			classifyOperatorTaskState(
				mapSessionSummaryToOperatorSignals({ state: "running" }, "in_progress", { deliveryGateHeld: true }),
			),
		).toBe("risky");
	});
});

describe("buildOperatorBoardSummary", () => {
	it("rolls up per-state counts + task-id lists and folds in the inbox", () => {
		const summary = buildOperatorBoardSummary([
			{ taskId: "ok", signals: HEALTHY },
			{ taskId: "ok2", signals: HEALTHY },
			{ taskId: "done", signals: { ...HEALTHY, columnId: "completed" } },
			{ taskId: "paused", signals: { ...HEALTHY, paused: true } },
			{ taskId: "danger", signals: { ...HEALTHY, deliveryGateHeld: true } },
		]);
		expect(summary.total).toBe(5);
		expect(summary.counts).toEqual({ healthy: 2, stuck: 1, risky: 1, done: 1 });
		expect(summary.byState.healthy).toEqual(["ok", "ok2"]);
		expect(summary.byState.risky).toEqual(["danger"]);
		// The risky task's held delivery is also in the inbox.
		expect(summary.inbox.heldDeliveries).toEqual(["danger"]);
		expect(summary.inbox.total).toBe(1);
	});

	it("is all-zero for an empty board", () => {
		const summary = buildOperatorBoardSummary([]);
		expect(summary.total).toBe(0);
		expect(summary.counts).toEqual({ healthy: 0, stuck: 0, risky: 0, done: 0 });
		expect(summary.inbox.total).toBe(0);
	});
});
