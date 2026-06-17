import { describe, expect, it, vi } from "vitest";

import { runVerifyTaskAcceptanceCommand } from "../../../src/commands/task";
import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import type { RuntimeBoardColumnId, RuntimeWorkspaceStateResponse } from "../../../src/core/api-contract";

const COLUMN_IDS: RuntimeBoardColumnId[] = ["backlog", "planning", "in_progress", "review", "completed", "trash"];

function createWorkspaceState(prompt: string): RuntimeWorkspaceStateResponse {
	return {
		repoPath: "/repo",
		statePath: "/state",
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
					id === "in_progress"
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

function createRuntimeConfigState(modelRoles: RuntimeConfigState["modelRoles"] = {}): RuntimeConfigState {
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
		modelRoles,
		shortcuts: [],
		commitPromptTemplate: "",
		openPrPromptTemplate: "",
		commitPromptTemplateDefault: "",
		openPrPromptTemplateDefault: "",
		globalConfigPath: "/repo/global.json",
		projectConfigPath: "/repo/project.json",
	};
}

describe("task verify command helper", () => {
	it("runs the acceptance gate in the task worktree", async () => {
		const runAcceptanceGate = vi.fn(async () => ({
			present: true,
			command: "npm test",
			passed: true,
			exitCode: 0,
			output: "ok",
			durationMs: 10,
		}));

		const result = await runVerifyTaskAcceptanceCommand(
			{
				cwd: "/repo",
				taskId: "task-1",
			},
			{
				resolveWorkspaceRepoPath: vi.fn(async () => "/repo"),
				loadWorkspaceState: vi.fn(async () => createWorkspaceState("Acceptance check: npm test")),
				resolveTaskCwd: vi.fn(async () => "/repo/.cline/worktrees/task-1/repo"),
				runAcceptanceGate,
			},
		);

		expect(runAcceptanceGate).toHaveBeenCalledWith({
			taskId: "task-1",
			workspacePath: "/repo/.cline/worktrees/task-1/repo",
			taskPrompt: "Acceptance check: npm test",
			timeoutMs: undefined,
		});
		expect(result).toMatchObject({
			ok: true,
			workspacePath: "/repo",
			taskWorkspacePath: "/repo/.cline/worktrees/task-1/repo",
			acceptance: {
				passed: true,
				command: "npm test",
			},
		});
	});

	it("returns ok false when the acceptance gate fails", async () => {
		const result = await runVerifyTaskAcceptanceCommand(
			{
				cwd: "/repo",
				taskId: "task-1",
				timeoutMs: 1_000,
			},
			{
				resolveWorkspaceRepoPath: vi.fn(async () => "/repo"),
				loadWorkspaceState: vi.fn(async () => createWorkspaceState("Acceptance check: npm test")),
				resolveTaskCwd: vi.fn(async () => "/worktree"),
				loadRuntimeConfig: vi.fn(async () =>
					createRuntimeConfigState({
						reviewer: {
							providerId: "anthropic",
							modelId: "claude-sonnet",
						},
					}),
				),
				runAcceptanceGate: vi.fn(async () => ({
					present: true,
					command: "npm test",
					passed: false,
					exitCode: 1,
					output: "failed",
					durationMs: 5,
				})),
			},
		);

		expect(result).toMatchObject({
			ok: false,
			error: 'Acceptance check failed for task "task-1".',
			acceptance: {
				passed: false,
				exitCode: 1,
				output: "failed",
			},
			repair: {
				action: "repair",
				attempt: 1,
				maxAttempts: 2,
			},
		});
	});

	it("returns escalation guidance after repair attempts are exhausted", async () => {
		const result = await runVerifyTaskAcceptanceCommand(
			{
				cwd: "/repo",
				taskId: "task-1",
				repairAttempt: 3,
				maxRepairAttempts: 2,
			},
			{
				resolveWorkspaceRepoPath: vi.fn(async () => "/repo"),
				loadWorkspaceState: vi.fn(async () => createWorkspaceState("Acceptance check: npm test")),
				resolveTaskCwd: vi.fn(async () => "/worktree"),
				loadRuntimeConfig: vi.fn(async () =>
					createRuntimeConfigState({
						reviewer: {
							providerId: "anthropic",
							modelId: "claude-sonnet",
						},
					}),
				),
				runAcceptanceGate: vi.fn(async () => ({
					present: true,
					command: "npm test",
					passed: false,
					exitCode: 1,
					output: "failed",
					durationMs: 5,
				})),
			},
		);

		expect(result).toMatchObject({
			ok: false,
			repair: {
				action: "escalate",
				attempt: 3,
				maxAttempts: 2,
				escalatedRole: "reviewer",
				escalatedSettings: {
					providerId: "anthropic",
					modelId: "claude-sonnet",
				},
			},
		});
	});

	it("returns ok false when the task has no acceptance check", async () => {
		const result = await runVerifyTaskAcceptanceCommand(
			{
				cwd: "/repo",
				taskId: "task-1",
				workspaceRoot: true,
			},
			{
				resolveWorkspaceRepoPath: vi.fn(async () => "/repo"),
				loadWorkspaceState: vi.fn(async () => createWorkspaceState("Implement the task.")),
				resolveTaskCwd: vi.fn(async () => "/worktree"),
				loadRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
				runAcceptanceGate: vi.fn(async () => ({
					present: false,
					command: null,
					passed: null,
					exitCode: null,
					output: "",
					durationMs: 0,
				})),
			},
		);

		expect(result).toMatchObject({
			ok: false,
			error: 'Task "task-1" has no Acceptance check line.',
			taskWorkspacePath: "/repo",
			acceptance: {
				present: false,
			},
		});
	});
});
