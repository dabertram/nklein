import { describe, expect, it } from "vitest";
import type { AgentLedgerEvent } from "../../../src/core/agent-attempt-ledger";
import {
	isAttemptEvent,
	isTransitionEvent,
	latestRunState,
	selectAttempts,
	selectAttemptsForModel,
	selectEventsForWorkflow,
} from "../../../src/core/agent-ledger-selectors";

function attempt(modelId: string, workflowId = "w1"): AgentLedgerEvent {
	return { kind: "attempt", modelId, workflowId } as unknown as AgentLedgerEvent;
}
function transition(to: string, recordedAt: number, workflowId = "w1"): AgentLedgerEvent {
	return { kind: "transition", to, recordedAt, workflowId } as unknown as AgentLedgerEvent;
}

describe("ledger selectors", () => {
	it("isAttemptEvent / isTransitionEvent discriminate by kind", () => {
		expect(isAttemptEvent(attempt("m1"))).toBe(true);
		expect(isAttemptEvent(transition("running", 1))).toBe(false);
		expect(isTransitionEvent(transition("running", 1))).toBe(true);
		expect(isTransitionEvent(attempt("m1"))).toBe(false);
	});

	it("selectAttempts keeps only attempt events", () => {
		expect(selectAttempts([attempt("m1"), transition("running", 1), attempt("m2")])).toHaveLength(2);
	});

	it("selectAttemptsForModel filters by canonical model id", () => {
		expect(selectAttemptsForModel([attempt("m1"), attempt("m2"), attempt("m1")], "m1")).toHaveLength(2);
	});

	it("selectEventsForWorkflow filters by workflow id", () => {
		const events = [attempt("m1", "w1"), attempt("m2", "w2"), transition("running", 1, "w1")];
		expect(selectEventsForWorkflow(events, "w1")).toHaveLength(2);
	});

	it("latestRunState returns the `to` of the most recent transition for the workflow", () => {
		const events = [
			transition("queued", 1, "w1"),
			transition("running", 5, "w1"),
			transition("done", 3, "w2"), // a different workflow — ignored
		];
		expect(latestRunState(events, "w1")).toBe("running");
	});

	it("latestRunState returns null when the workflow never transitioned", () => {
		expect(latestRunState([attempt("m1", "w1")], "w1")).toBeNull();
	});
});
