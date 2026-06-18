import { describe, expect, it, vi } from "vitest";

import {
	addPlanGapIntegrationCardToBoard,
	markTaskNeedsDecompositionOnBoard,
	recordDecompositionRejection,
	runVerifyTaskAcceptanceCommand,
} from "../../../src/commands/task";
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
		const recordPlanGap = vi.fn();
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
				recordPlanGap,
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
		expect(recordPlanGap).not.toHaveBeenCalled();
	});

	it("returns escalation guidance after repair attempts are exhausted", async () => {
		const recordPlanGap = vi.fn();
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
				recordPlanGap,
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
		expect(recordPlanGap).toHaveBeenCalledWith({
			workspacePath: "/repo",
			taskId: "task-1",
			kind: "other",
			description:
				"Acceptance repair attempts are exhausted; the task needs plan-level review before more implementation work.",
			evidence: "Command: npm test\nOutput: failed",
		});
	});

	it("returns ok false when the task has no acceptance check", async () => {
		const recordPlanGap = vi.fn();
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
				recordPlanGap,
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
		expect(recordPlanGap).toHaveBeenCalledWith({
			workspacePath: "/repo",
			taskId: "task-1",
			kind: "other",
			description:
				"Task is missing the required Acceptance check line, so the plan lacks a machine-checkable completion contract.",
			evidence: "Implement the task.",
		});
	});
});

describe("task decompose command telemetry", () => {
	it("records rejected plan task graphs for self-observation", () => {
		const recordObservation = vi.fn();

		recordDecompositionRejection({
			workspacePath: "/repo",
			slug: "checkout-rework",
			title: "Checkout rework",
			specPath: "/repo/.cline/kanban/plans/checkout-rework/spec.md",
			planPath: "/repo/.cline/kanban/plans/checkout-rework/plan.md",
			questionsPath: "/repo/.cline/kanban/plans/checkout-rework/questions.md",
			decisionsPath: "/repo/.cline/kanban/plans/checkout-rework/decisions.md",
			revisionsPath: "/repo/.cline/kanban/plans/checkout-rework/revisions.md",
			summaryPath: "/repo/.cline/kanban/plans/checkout-rework/summary.md",
			taskGraphPath: "/repo/.cline/kanban/plans/checkout-rework/tasks.json",
			error: new Error("Task api has complexity 90/100; split it below 75/100 before decomposing."),
			recordObservation,
		});

		expect(recordObservation).toHaveBeenCalledWith({
			signal: "decomposition_rejected",
			severity: "warning",
			message:
				'Task decomposition rejected for plan "checkout-rework": Task api has complexity 90/100; split it below 75/100 before decomposing.',
			workspacePath: "/repo",
			metadata: {
				slug: "checkout-rework",
				title: "Checkout rework",
				specPath: "/repo/.cline/kanban/plans/checkout-rework/spec.md",
				planPath: "/repo/.cline/kanban/plans/checkout-rework/plan.md",
				questionsPath: "/repo/.cline/kanban/plans/checkout-rework/questions.md",
				decisionsPath: "/repo/.cline/kanban/plans/checkout-rework/decisions.md",
				revisionsPath: "/repo/.cline/kanban/plans/checkout-rework/revisions.md",
				summaryPath: "/repo/.cline/kanban/plans/checkout-rework/summary.md",
				taskGraphPath: "/repo/.cline/kanban/plans/checkout-rework/tasks.json",
				error: "Task api has complexity 90/100; split it below 75/100 before decomposing.",
			},
		});
	});
});

describe("task start command blocking", () => {
	it("marks tasks that need decomposition on the board", () => {
		const board = createWorkspaceState("Implement a broad task.").board;

		const nextBoard = markTaskNeedsDecompositionOnBoard(
			board,
			"task-1",
			"Task start blocked: this card needs decomposition.",
		);
		const task = nextBoard.columns.find((column) => column.id === "in_progress")?.cards[0];

		expect(task).toMatchObject({
			blockedKind: "needs_decomposition",
			blockedReason: "Task start blocked: this card needs decomposition.",
		});
	});
});

describe("task plan-gap adaptation", () => {
	it("adds an integration card for integration-needed gaps", () => {
		const state = createWorkspaceState("Acceptance check: npm test");

		const result = addPlanGapIntegrationCardToBoard({
			state,
			taskId: "task-1",
			description: "The API and UI cards both changed the saved payload and need a shared migration.",
			evidence: "src/api.ts and web-ui/src/form.ts disagree about field names.",
			baseRef: "main",
			createId: () => "abcde-integration-task",
		});
		const planningCard = result.board.columns
			.find((column) => column.id === "planning")
			?.cards.find((card) => card.id === result.task.id);

		expect(result.task.id).toBe("abcde");
		expect(planningCard).toMatchObject({
			id: "abcde",
			title: "Integrate plan gap from task-1",
			startInPlanMode: true,
			autoReviewEnabled: true,
			autoReviewMode: "commit",
			agentId: "cline",
			baseRef: "main",
		});
		expect(planningCard?.prompt).toContain('reported by task "task-1"');
		expect(planningCard?.prompt).toContain("shared migration");
		expect(planningCard?.prompt).toContain("Evidence: src/api.ts");
	});
});
