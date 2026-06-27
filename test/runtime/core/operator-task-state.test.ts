import { describe, expect, it } from "vitest";
import { classifyOperatorTaskState, type OperatorTaskSignals } from "../../../src/core/operator-task-state";

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
