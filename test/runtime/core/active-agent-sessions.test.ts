import { describe, expect, it } from "vitest";
import {
	countActiveAgentSessions,
	countAttentionParkedSessions,
	type RuntimeTaskSessionReviewReason,
	type RuntimeTaskSessionState,
} from "../../../src/core/task-session-api-contract";

function s(state: RuntimeTaskSessionState): { state: RuntimeTaskSessionState } {
	return { state };
}

function sr(
	state: RuntimeTaskSessionState,
	reviewReason: RuntimeTaskSessionReviewReason | null,
): { state: RuntimeTaskSessionState; reviewReason: RuntimeTaskSessionReviewReason | null } {
	return { state, reviewReason };
}

describe("countActiveAgentSessions", () => {
	it("counts running and queued separately, ignoring inactive states", () => {
		const counts = countActiveAgentSessions([
			s("running"),
			s("running"),
			s("queued"),
			s("paused"),
			s("awaiting_review"),
			s("idle"),
			s("failed"),
			s("interrupted"),
		]);
		expect(counts).toEqual({ running: 2, queued: 1 });
	});

	it("returns zeros for an empty set", () => {
		expect(countActiveAgentSessions([])).toEqual({ running: 0, queued: 0 });
	});

	it("treats only running + queued as active (not paused/awaiting_review)", () => {
		const counts = countActiveAgentSessions([s("paused"), s("awaiting_review"), s("idle")]);
		expect(counts).toEqual({ running: 0, queued: 0 });
	});
});

describe("countAttentionParkedSessions", () => {
	it("counts only awaiting_review sessions parked with reason 'attention' (the needs-you surface)", () => {
		const parked = countAttentionParkedSessions([
			sr("awaiting_review", "attention"), // the §12 turn-loop park / autonomy park
			sr("awaiting_review", "error"), // a crash, not an operator question
			sr("awaiting_review", "exit"),
			sr("awaiting_review", "interrupted"),
			sr("running", "attention"), // reason without the parked state doesn't count
			sr("idle", null),
		]);
		expect(parked).toBe(1);
	});

	it("returns 0 for an empty set", () => {
		expect(countAttentionParkedSessions([])).toBe(0);
	});
});
