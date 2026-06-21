import { TeamMessageType } from "@nklein/shared";
import { describe, expect, it } from "vitest";

import { projectNKleinTeamProgressEvent } from "../../../src/nklein-sdk/nklein-team-progress";
import type { NKleinSdkTeamEvent } from "../../../src/nklein-sdk/sdk-runtime-boundary";

describe("projectNKleinTeamProgressEvent", () => {
	it("projects run progress into a stable UI event", () => {
		const event = {
			type: TeamMessageType.RunProgress,
			run: {
				id: "run-1",
				agentId: "worker",
				status: "running",
				message: "Update persistence adapter",
				priority: 1,
				retryCount: 0,
				maxRetries: 0,
				startedAt: new Date(123),
			},
			message: "Worker is updating the persistence adapter and checking tests.",
		} satisfies NKleinSdkTeamEvent;

		const projected = projectNKleinTeamProgressEvent({
			taskId: "task-1",
			teamName: "kanban-task-1",
			event,
			createdAt: 123,
		});

		expect(projected).toEqual({
			taskId: "task-1",
			teamName: "kanban-task-1",
			eventType: "run_progress",
			agentId: null,
			role: null,
			runId: "run-1",
			status: "running",
			message: "Worker is updating the persistence adapter and checking tests.",
			createdAt: 123,
		});
	});

	it("summarizes teammate lifecycle events", () => {
		const event = {
			type: TeamMessageType.TeammateSpawned,
			agentId: "reviewer",
			role: "reviewer",
			teammate: {
				rolePrompt: "Review the patch.",
				runtimeAgentId: "reviewer",
			},
		} satisfies NKleinSdkTeamEvent;

		const projected = projectNKleinTeamProgressEvent({
			taskId: "task-1",
			teamName: null,
			event,
			createdAt: 456,
		});

		expect(projected.eventType).toBe("teammate_spawned");
		expect(projected.agentId).toBe("reviewer");
		expect(projected.role).toBe("reviewer");
		expect(projected.message).toBe("Spawned reviewer.");
	});

	it("frames task_end events with string errors as failures", () => {
		const event = {
			type: TeamMessageType.TaskEnd,
			agentId: "worker",
			error: "Acceptance check failed.",
		} as unknown as NKleinSdkTeamEvent;

		const projected = projectNKleinTeamProgressEvent({
			taskId: "task-1",
			teamName: "kanban-task-1",
			event,
			createdAt: 789,
		});

		expect(projected.message).toBe("Agent worker failed: Acceptance check failed.");
	});
});
