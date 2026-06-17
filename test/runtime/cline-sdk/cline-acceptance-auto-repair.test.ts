import { describe, expect, it, vi } from "vitest";

import { runClineAcceptanceAutoRepair } from "../../../src/cline-sdk/cline-acceptance-auto-repair";
import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import type { RuntimeTaskSessionSummary, RuntimeWorkspaceStateResponse } from "../../../src/core/api-contract";

const COLUMN_IDS = ["backlog", "planning", "in_progress", "review", "completed", "trash"] as const;

function createSummary(): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "awaiting_review",
		mode: "act",
		agentId: "cline",
		workspacePath: "/repo/.cline/worktrees/task-1/repo",
		pid: null,
		startedAt: 1,
		updatedAt: 2,
		lastOutputAt: 2,
		reviewReason: "hook",
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

function createWorkspaceState(prompt = "Acceptance check: npm test"): RuntimeWorkspaceStateResponse {
	return {
		repoPath: "/repo",
		statePath: "/repo/.cline/kanban/state.json",
		git: {
			currentBranch: "main",
			defaultBranch: "main",
			branches: ["main"],
		},
		board: {
			columns: COLUMN_IDS.map((id) => ({
				id,
				title: id,
				cards:
					id === "review"
						? [
								{
									id: "task-1",
									title: "Task 1",
									prompt,
									startInPlanMode: false,
									autoReviewEnabled: true,
									autoReviewMode: "commit",
									baseRef: "main",
									createdAt: 1,
									updatedAt: 2,
								},
							]
						: [],
			})),
			dependencies: [],
		},
		sessions: {},
		revision: 1,
	};
}

function createRuntimeConfigState(): RuntimeConfigState {
	return {
		selectedAgentId: "cline",
		selectedShortcutLabel: null,
		agentAutonomousModeEnabled: true,
		agentTimeoutMode: "normal",
		agentTimeoutProfile: "local",
		requestTimeoutMs: null,
		streamTimeoutMs: null,
		toolTimeoutMs: null,
		agentTimeoutMs: null,
		conversationTimeoutMs: null,
		maxAgentWritableFileLines: 1000,
		maxConcurrentTasks: 3,
		readyForReviewNotificationsEnabled: true,
		modelRoles: {
			reviewer: {
				providerId: "anthropic",
				modelId: "claude-sonnet",
				reasoningEffort: "high",
			},
		},
		shortcuts: [],
		commitPromptTemplate: "",
		openPrPromptTemplate: "",
		commitPromptTemplateDefault: "",
		openPrPromptTemplateDefault: "",
		globalConfigPath: "/repo/global.json",
		projectConfigPath: "/repo/project.json",
	};
}

describe("cline acceptance auto repair", () => {
	it("returns ready when the acceptance gate passes", async () => {
		const attemptStore = new Map<string, number>();
		attemptStore.set("task-1", 1);

		const outcome = await runClineAcceptanceAutoRepair({
			workspacePath: "/repo",
			taskId: "task-1",
			summary: createSummary(),
			service: {
				sendTaskSessionInput: vi.fn(),
			},
			attemptStore,
			loadWorkspaceState: vi.fn(async () => createWorkspaceState()),
			resolveTaskCwd: vi.fn(async () => "/worktree"),
			runAcceptanceGate: vi.fn(async () => ({
				present: true,
				command: "npm test",
				passed: true,
				exitCode: 0,
				output: "ok",
				durationMs: 20,
			})),
			loadRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
		});

		expect(outcome).toEqual({ type: "ready", reason: "passed" });
		expect(attemptStore.has("task-1")).toBe(false);
	});

	it("sends a repair prompt when the acceptance gate fails within the repair budget", async () => {
		const sendTaskSessionInput = vi.fn(async () => createSummary());
		const outcome = await runClineAcceptanceAutoRepair({
			workspacePath: "/repo",
			taskId: "task-1",
			summary: createSummary(),
			service: {
				sendTaskSessionInput,
			},
			attemptStore: new Map<string, number>(),
			loadWorkspaceState: vi.fn(async () => createWorkspaceState()),
			resolveTaskCwd: vi.fn(async () => "/worktree"),
			runAcceptanceGate: vi.fn(async () => ({
				present: true,
				command: "npm test",
				passed: false,
				exitCode: 1,
				output: "failed",
				durationMs: 20,
			})),
			loadRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
		});

		expect(outcome).toMatchObject({
			type: "repair_sent",
			action: "repair",
			attempt: 1,
		});
		expect(sendTaskSessionInput).toHaveBeenCalledWith(
			"task-1",
			expect.stringContaining("Acceptance check failed"),
			"act",
			undefined,
			undefined,
		);
	});

	it("escalates to reviewer settings after repair attempts are exhausted", async () => {
		const sendTaskSessionInput = vi.fn(async () => createSummary());
		const attemptStore = new Map<string, number>([["task-1", 2]]);
		const outcome = await runClineAcceptanceAutoRepair({
			workspacePath: "/repo",
			taskId: "task-1",
			summary: createSummary(),
			service: {
				sendTaskSessionInput,
			},
			attemptStore,
			maxAttempts: 2,
			loadWorkspaceState: vi.fn(async () => createWorkspaceState()),
			resolveTaskCwd: vi.fn(async () => "/worktree"),
			runAcceptanceGate: vi.fn(async () => ({
				present: true,
				command: "npm test",
				passed: false,
				exitCode: 1,
				output: "failed",
				durationMs: 20,
			})),
			loadRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
		});

		expect(outcome).toMatchObject({
			type: "repair_sent",
			action: "escalate",
			attempt: 3,
		});
		expect(sendTaskSessionInput).toHaveBeenCalledWith(
			"task-1",
			expect.stringContaining("escalate this task to the reviewer role"),
			"act",
			undefined,
			{
				providerId: "anthropic",
				modelId: "claude-sonnet",
				reasoningEffort: "high",
			},
		);
	});
});
