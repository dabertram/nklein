import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { runNKleinAcceptanceAutoRepair } from "../../../src/nklein-agent/nklein-acceptance-auto-repair";
import type { NKleinTaskSessionService } from "../../../src/nklein-agent/nklein-task-session-service";
import { createRuntimeStateHub } from "../../../src/server/runtime-state-hub";

vi.mock("../../../src/nklein-agent/nklein-acceptance-auto-repair", () => ({
	runNKleinAcceptanceAutoRepair: vi.fn(async () => ({ type: "ready", reason: "human_review" })),
}));

const runNKleinAcceptanceAutoRepairMock = vi.mocked(runNKleinAcceptanceAutoRepair);

function createAwaitingReviewSummary(taskId: string): RuntimeTaskSessionSummary {
	const timestamp = Date.now();
	return {
		taskId,
		state: "awaiting_review",
		mode: "act",
		agentId: "nklein",
		workspacePath: "/workspaces/task-1",
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
		reviewReason: "exit",
		exitCode: null,
		lastHookAt: timestamp,
		latestHookActivity: null,
		warningMessage: null,
		latestUsage: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

function createTrackedService(summary: RuntimeTaskSessionSummary): NKleinTaskSessionService {
	const emitter = new EventEmitter();
	const service = {
		listSummaries: () => [summary],
		onSummary: (listener: (nextSummary: RuntimeTaskSessionSummary) => void) => {
			emitter.on("summary", listener);
			return () => emitter.off("summary", listener);
		},
		onMessage: () => () => {},
		onTeamProgress: () => () => {},
		sendTaskSessionInput: vi.fn(async () => null),
	} satisfies Pick<
		NKleinTaskSessionService,
		"listSummaries" | "onSummary" | "onMessage" | "onTeamProgress" | "sendTaskSessionInput"
	>;
	return service as unknown as NKleinTaskSessionService;
}

describe("createRuntimeStateHub", () => {
	beforeEach(() => {
		runNKleinAcceptanceAutoRepairMock.mockClear();
	});

	it("verifies nklein summaries that are already awaiting review when tracked", async () => {
		const summary = createAwaitingReviewSummary("task-1");
		const service = createTrackedService(summary);
		const hub = createRuntimeStateHub({
			workspaceRegistry: {
				resolveWorkspaceForStream: vi.fn(async () => ({
					workspaceId: null,
					workspacePath: null,
					removedRequestedWorkspacePath: null,
					didPruneProjects: false,
				})),
				buildProjectsPayload: vi.fn(async () => ({ projects: [], currentProjectId: null })),
				buildWorkspaceStateSnapshot: vi.fn(async () => {
					throw new Error("not used");
				}),
			},
		});

		try {
			hub.trackNKleinTaskSessionService("workspace-1", "/tmp/project", service);

			await vi.waitFor(() => {
				expect(runNKleinAcceptanceAutoRepairMock).toHaveBeenCalledWith(
					expect.objectContaining({
						workspacePath: "/tmp/project",
						taskId: "task-1",
						summary,
						service,
					}),
				);
			});
		} finally {
			await hub.close();
		}
	});
});
