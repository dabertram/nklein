import { describe, expect, it } from "vitest";

import type { RuntimeTaskSessionSummary } from "../../../src/core/task-session-api-contract";
import type { RuntimeWorkspaceStateResponse } from "../../../src/core/workspace-projects-api-contract";
import { applyLiveSessionsToWorkspaceState } from "../../../src/state/workspace-live-session-merge";

function summary(taskId: string, state: RuntimeTaskSessionSummary["state"]): RuntimeTaskSessionSummary {
	const timestamp = 1_000;
	return {
		taskId,
		state,
		mode: "act",
		agentId: "nklein",
		workspacePath: "/workspaces/ws",
		pid: null,
		startedAt: timestamp,
		updatedAt: timestamp,
		lastOutputAt: timestamp,
		lastTokenAt: null,
		lastHeartbeatAt: timestamp,
		heartbeatStatus: "healthy",
		providerId: "lmstudio",
		modelId: "local-model",
		endpoint: "http://localhost:1234/v1",
		sharedEndpointId: "http://localhost:1234/v1",
		reviewReason: null,
		exitCode: null,
		lastHookAt: timestamp,
		latestHookActivity: null,
		warningMessage: null,
		latestUsage: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

// applyLiveSessionsToWorkspaceState only reads/writes `.sessions`; the rest of the response is irrelevant here.
function responseWithSessions(sessions: Record<string, RuntimeTaskSessionSummary>): RuntimeWorkspaceStateResponse {
	return { sessions } as unknown as RuntimeWorkspaceStateResponse;
}

describe("applyLiveSessionsToWorkspaceState (the §5.U M2 persisted+live session merge)", () => {
	it("lets a live summary REPLACE the persisted entry for the same taskId (live wins — fresher than disk)", () => {
		const response = responseWithSessions({ "task-1": summary("task-1", "idle") });
		applyLiveSessionsToWorkspaceState(response, [summary("task-1", "running")]);
		expect(response.sessions["task-1"]?.state).toBe("running");
	});

	it("retains a persisted-only task that has no live session", () => {
		const persistedOnly = summary("task-persisted", "awaiting_review");
		const response = responseWithSessions({ "task-persisted": persistedOnly });
		applyLiveSessionsToWorkspaceState(response, [summary("task-live", "running")]);
		// The persisted-only task is untouched...
		expect(response.sessions["task-persisted"]).toBe(persistedOnly);
		// ...and the live-only task is added.
		expect(response.sessions["task-live"]?.state).toBe("running");
	});

	it("adds live-only tasks not present in the persisted sessions", () => {
		const response = responseWithSessions({});
		applyLiveSessionsToWorkspaceState(response, [summary("task-a", "running"), summary("task-b", "idle")]);
		expect(Object.keys(response.sessions).sort()).toEqual(["task-a", "task-b"]);
	});

	it("leaves the persisted sessions unchanged when there are no live summaries", () => {
		const persisted = summary("task-1", "awaiting_review");
		const response = responseWithSessions({ "task-1": persisted });
		applyLiveSessionsToWorkspaceState(response, []);
		expect(response.sessions).toEqual({ "task-1": persisted });
	});

	it("merges a mix: replaces overlapping taskIds, keeps persisted-only, adds live-only", () => {
		const response = responseWithSessions({
			shared: summary("shared", "idle"),
			"persisted-only": summary("persisted-only", "awaiting_review"),
		});
		applyLiveSessionsToWorkspaceState(response, [summary("shared", "running"), summary("live-only", "running")]);
		expect(response.sessions.shared?.state).toBe("running"); // replaced
		expect(response.sessions["persisted-only"]?.state).toBe("awaiting_review"); // kept
		expect(response.sessions["live-only"]?.state).toBe("running"); // added
		expect(Object.keys(response.sessions).sort()).toEqual(["live-only", "persisted-only", "shared"]);
	});
});
