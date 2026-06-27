import { describe, expect, it, vi } from "vitest";
import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import type { RuntimeTaskSessionSummary, RuntimeWorkspaceStateResponse } from "../../../src/core/api-contract";
import { DEFAULT_RUNTIME_SWARM_GUARDRAILS } from "../../../src/core/api-contract";
import { runNKleinAcceptanceAutoRepair } from "../../../src/nklein-agent/nklein-acceptance-auto-repair";

const COLUMN_IDS = ["backlog", "planning", "in_progress", "review", "completed", "trash"] as const;

function createSummary(): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "awaiting_review",
		mode: "act",
		agentId: "nklein",
		workspacePath: "/repo",
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

function createAcceptanceResult(passed: boolean) {
	return {
		present: true as const,
		command: "npm test",
		passed,
		exitCode: passed ? 0 : 1,
		output: passed ? "ok" : "failed",
		durationMs: 20,
		failureCategory: null,
		failureHint: null,
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
		workspaceBaseDir: null,
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
		maxConcurrentTasksOverride: null,
		effectiveMaxConcurrentTasks: 3,
		selectedAgentIdOverride: null,
		effectiveSelectedAgentId: "nklein",
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
		concurrencyDefaults: { perProvider: {}, perModel: {} },
		concurrencyOverride: null,
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
		modelRolesOverride: null,
		effectiveModelRoles: {
			reviewer: {
				providerId: "anthropic",
				modelId: "claude-sonnet",
				reasoningEffort: "high",
			},
		},
		agentRulesetsOverride: null,
		swarmGuardrails: DEFAULT_RUNTIME_SWARM_GUARDRAILS,
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
	it("returns ready when the sandbox acceptance gate passes", async () => {
		const attemptStore = new Map<string, number>();
		attemptStore.set("task-1", 1);

		const outcome = await runNKleinAcceptanceAutoRepair({
			workspacePath: "/repo",
			taskId: "task-1",
			summary: createSummary(),
			service: {
				sendTaskSessionInput: vi.fn(),
				verifyTaskAcceptanceInSandbox: vi.fn(async () => createAcceptanceResult(true)),
			},
			attemptStore,
			loadWorkspaceState: vi.fn(async () => createWorkspaceState()),
			loadRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
		});

		expect(outcome).toEqual({ type: "ready", reason: "passed" });
		expect(attemptStore.has("task-1")).toBe(false);
	});

	it("skips when no sandbox acceptance verifier is available", async () => {
		const outcome = await runNKleinAcceptanceAutoRepair({
			workspacePath: "/repo",
			taskId: "task-1",
			summary: createSummary(),
			service: {
				sendTaskSessionInput: vi.fn(),
			},
			attemptStore: new Map<string, number>(),
			loadWorkspaceState: vi.fn(async () => createWorkspaceState()),
			loadRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
		});

		expect(outcome).toEqual({ type: "skipped", reason: "acceptance_unavailable" });
	});

	it("sends a repair prompt when the sandbox acceptance gate fails within the repair budget", async () => {
		const sendTaskSessionInput = vi.fn(async () => createSummary());
		const outcome = await runNKleinAcceptanceAutoRepair({
			workspacePath: "/repo",
			taskId: "task-1",
			summary: createSummary(),
			service: {
				sendTaskSessionInput,
				verifyTaskAcceptanceInSandbox: vi.fn(async () => createAcceptanceResult(false)),
			},
			attemptStore: new Map<string, number>(),
			loadWorkspaceState: vi.fn(async () => createWorkspaceState()),
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

	it("verifies acceptance against the task's sandbox working copy", async () => {
		const sendTaskSessionInput = vi.fn(async () => createSummary());
		const verifyTaskAcceptanceInSandbox = vi.fn(async () => createAcceptanceResult(false));

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
			loadRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
		});

		expect(verifyTaskAcceptanceInSandbox).toHaveBeenCalledWith({
			taskId: "task-1",
			projectRepoPath: "/repo",
			baseRef: "main",
			taskPrompt: "Acceptance check: npm test",
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
		const outcome = await runNKleinAcceptanceAutoRepair({
			workspacePath: "/repo",
			taskId: "task-1",
			summary: createSummary(),
			service: {
				sendTaskSessionInput,
				verifyTaskAcceptanceInSandbox: vi.fn(async () => createAcceptanceResult(false)),
			},
			attemptStore,
			maxAttempts: 2,
			loadWorkspaceState: vi.fn(async () => createWorkspaceState()),
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
