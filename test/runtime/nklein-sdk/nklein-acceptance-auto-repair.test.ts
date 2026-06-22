import { describe, expect, it, vi } from "vitest";
import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import type { RuntimeTaskSessionSummary, RuntimeWorkspaceStateResponse } from "../../../src/core/api-contract";
import { runNKleinAcceptanceAutoRepair } from "../../../src/nklein-sdk/nklein-acceptance-auto-repair";

const COLUMN_IDS = ["backlog", "planning", "in_progress", "review", "completed", "trash"] as const;

function createSummary(): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "awaiting_review",
		mode: "act",
		agentId: "nklein",
		workspacePath: "/repo/.nklein/worktrees/task-1/repo",
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
		statePath: "/repo/.nklein/nklein/state.json",
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
		selectedAgentId: "nklein",
		selectedShortcutLabel: null,
		developerModeEnabled: false,
		replayCardsEnabled: false,
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
		sandboxMaxContainers: 1,
		sandboxAgentsPerContainer: 0,
		sandboxMemoryPerContainerMb: 4096,
		sandboxCpusPerContainer: 2,
		sandboxIdleTimeoutMinutes: 10,
		lostHeartbeatPolicy: "park",
		decompositionAutoApplyEnabled: true,
		secondOpinionReviewEnabled: true,
		reviewMaxRounds: 20,
		readyForReviewNotificationsEnabled: true,
		codeEmbeddingDefaults: {
			provider: "local_lexical",
			model: "kanban-local-lexical-vector-v1",
			baseUrl: null,
		},
		codeEmbeddingOverride: null,
		effectiveCodeEmbeddingSettings: {
			provider: "local_lexical",
			model: "kanban-local-lexical-vector-v1",
			baseUrl: null,
		},
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

describe("nklein acceptance auto repair", () => {
	it("returns ready when the acceptance gate passes", async () => {
		const attemptStore = new Map<string, number>();
		attemptStore.set("task-1", 1);

		const outcome = await runNKleinAcceptanceAutoRepair({
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
				failureCategory: null,
				failureHint: null,
			})),
			loadRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
		});

		expect(outcome).toEqual({ type: "ready", reason: "passed" });
		expect(attemptStore.has("task-1")).toBe(false);
	});

	it("sends a repair prompt when the acceptance gate fails within the repair budget", async () => {
		const sendTaskSessionInput = vi.fn(async () => createSummary());
		const outcome = await runNKleinAcceptanceAutoRepair({
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
				failureCategory: null,
				failureHint: null,
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

	it("uses the scoped service sandbox verifier for automatic repair checks", async () => {
		const sendTaskSessionInput = vi.fn(async () => createSummary());
		const resolveTaskCwd = vi.fn(async () => "/legacy-worktree");
		const verifyTaskAcceptanceInSandbox = vi.fn(async () => ({
			present: true,
			command: "npm test",
			passed: false,
			exitCode: 1,
			output: "failed",
			durationMs: 20,
			failureCategory: null,
			failureHint: null,
		}));

		const outcome = await runNKleinAcceptanceAutoRepair({
			workspacePath: "/repo",
			taskId: "task-1",
			summary: createSummary(),
			service: {
				sendTaskSessionInput,
				verifyTaskAcceptanceInSandbox,
			},
			attemptStore: new Map<string, number>(),
			loadWorkspaceState: vi.fn(async () => createWorkspaceState()),
			resolveTaskCwd,
			loadRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
		});

		expect(verifyTaskAcceptanceInSandbox).toHaveBeenCalledWith({
			taskId: "task-1",
			projectRepoPath: "/repo",
			baseRef: "main",
			taskPrompt: "Acceptance check: npm test",
		});
		expect(resolveTaskCwd).not.toHaveBeenCalled();
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
		const outcome = await runNKleinAcceptanceAutoRepair({
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
				failureCategory: null,
				failureHint: null,
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
