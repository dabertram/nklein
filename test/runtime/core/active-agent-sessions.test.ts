import { describe, expect, it } from "vitest";
import { countActiveAgentSessions, type RuntimeTaskSessionState } from "../../../src/core/task-session-api-contract";

function s(state: RuntimeTaskSessionState): { state: RuntimeTaskSessionState } {
	return { state };
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
