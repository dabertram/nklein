import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import type { RuntimeBoardCard, RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { DEFAULT_RUNTIME_SWARM_GUARDRAILS } from "../../../src/core/api-contract";
import {
	buildModelPerformanceObservation,
	readModelPerformanceStats,
	recordModelPerformanceObservation,
} from "../../../src/telemetry/model-performance-stats";

async function createStatsRoot(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "nklein-model-performance-"));
}

function createRuntimeConfig(): RuntimeConfigState {
	return {
		globalConfigPath: "/tmp/global.json",
		projectConfigPath: "/tmp/project.json",
		selectedAgentId: "nklein",
		selectedShortcutLabel: null,
		workspaceBaseDir: null,
		developerModeEnabled: true,
		replayCardsEnabled: true,
		setupWizardCompletedAt: null,
		projectSetupWizardCompletedAt: null,
		knowsTodayEnabled: false,
		sandboxMcpServersEnabled: true,
		retrievalEgressEnabled: false,
		retrievalSearchBackendUrl: null,
		fileOverlapParallelism: "serialize",
		fileOverlapParallelismOverride: null,
		effectiveFileOverlapParallelism: "serialize",
		agentAutonomousModeEnabled: true,
		agentTimeoutMode: "normal",
		agentTimeoutProfile: "local",
		requestTimeoutMs: null,
		streamTimeoutMs: null,
		toolTimeoutMs: null,
		agentTimeoutMs: null,
		conversationTimeoutMs: null,
		maxAgentWritableFileLines: 400,
		maxConcurrentTasks: 2,
		maxConcurrentTasksOverride: null,
		effectiveMaxConcurrentTasks: 2,
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
		codeEmbeddingDefaults: { provider: "local_lexical", model: null, baseUrl: null },
		codeEmbeddingOverride: null,
		concurrencyDefaults: { perProvider: {}, perModel: {} },
		concurrencyOverride: null,
		effectiveCodeEmbeddingSettings: { provider: "local_lexical", model: null, baseUrl: null },
		modelSuitabilityPolicyDefaults: { onUnsuitable: "reject", onUnknown: "warn" },
		modelSuitabilityPolicyOverride: null,
		effectiveModelSuitabilityPolicy: { onUnsuitable: "reject", onUnknown: "warn" },
		skillDynamicsLevelDefault: "fully_dynamic",
		skillDynamicsLevelOverride: null,
		effectiveSkillDynamicsLevel: "fully_dynamic",
		modelRoles: {
			worker: { providerId: "ollama", modelId: "qwen2.5-coder" },
			reviewer: { providerId: "lmstudio", modelId: "deepseek-coder" },
		},
		modelRolesOverride: null,
		effectiveModelRoles: {
			worker: { providerId: "ollama", modelId: "qwen2.5-coder" },
			reviewer: { providerId: "lmstudio", modelId: "deepseek-coder" },
		},
		agentRulesetsOverride: null,
		swarmGuardrails: DEFAULT_RUNTIME_SWARM_GUARDRAILS,
		shortcuts: [],
		commitPromptTemplate: "commit",
		openPrPromptTemplate: "pr",
		commitPromptTemplateDefault: "commit",
		openPrPromptTemplateDefault: "pr",
	};
}

function createCard(taskId: string): RuntimeBoardCard {
	return {
		id: taskId,
		title: "Implement habit trends",
		prompt: "Add habit trend summaries.",
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 100,
		updatedAt: 100,
	};
}

function createSummary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "habit-trends",
		state: "awaiting_review",
		mode: "act",
		agentId: "nklein",
		workspacePath: "/tmp/project-a",
		pid: null,
		startedAt: 1_000,
		updatedAt: 11_000,
		lastOutputAt: 10_000,
		lastTokenAt: 3_000,
		lastHeartbeatAt: 10_500,
		heartbeatStatus: "healthy",
		providerId: "ollama",
		modelId: "qwen2.5-coder",
		endpoint: "http://127.0.0.1:11434",
		sharedEndpointId: null,
		reviewReason: "exit",
		exitCode: 0,
		lastHookAt: null,
		latestHookActivity: null,
		warningMessage: null,
		latestUsage: {
			inputTokens: 1200,
			outputTokens: 300,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
		contextBudgetBreakdown: {
			systemPromptTokens: 100,
			toolSchemaTokens: 200,
			taskPromptTokens: 50,
			userMessageTokens: 60,
			includedFileContentTokens: 700,
			otherHistoryTokens: 90,
			reservedPromptOverheadTokens: 40,
			reservedOutputTokens: 512,
			usedWorkingTokens: 2048,
			freeWorkingTokens: 2048,
			effectiveContextWindow: 4096,
			projectedTokens: 2560,
		},
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...overrides,
	};
}

describe("model performance stats", () => {
	it("builds typed observations with role attribution, durations, and context pressure", () => {
		const observation = buildModelPerformanceObservation({
			workspaceId: "workspace-a",
			workspacePath: "/tmp/project-a",
			card: createCard("habit-trends"),
			runtimeConfig: createRuntimeConfig(),
			summary: createSummary(),
			now: 20_000,
		});

		expect(observation).toMatchObject({
			recordedAt: 20_000,
			taskTitle: "Implement habit trends",
			role: "worker",
			roleSource: "model_roles",
			providerId: "ollama",
			modelId: "qwen2.5-coder",
			outcome: "completed",
			wallTimeMs: 10_000,
			timeToFirstTokenMs: 2_000,
			timeToLastOutputMs: 9_000,
			contextPressure: 0.5,
		});
	});

	it("classifies completed decomposition source sessions that settle back to idle", () => {
		const observation = buildModelPerformanceObservation({
			workspaceId: "workspace-a",
			workspacePath: "/tmp/project-a",
			card: createCard("habit-trends"),
			runtimeConfig: createRuntimeConfig(),
			summary: createSummary({
				state: "idle",
				reviewReason: null,
				latestHookActivity: {
					activityText: "Decomposition applied; source task completed.",
					toolName: "decompose_project",
					toolInputSummary: null,
					finalMessage: null,
					hookEventName: "decomposition_applied",
					notificationType: null,
					source: "nklein",
				},
			}),
			now: 20_000,
		});

		expect(observation?.outcome).toBe("completed");
	});

	it("deduplicates repeated summary emissions and aggregates by project, version, role, and model", async () => {
		const rootDir = await createStatsRoot();
		const runtimeConfig = createRuntimeConfig();
		const summary = createSummary();
		await recordModelPerformanceObservation({
			rootDir,
			workspaceId: "workspace-a",
			workspacePath: "/tmp/project-a",
			card: createCard(summary.taskId),
			runtimeConfig,
			summary,
			now: 20_000,
		});
		await recordModelPerformanceObservation({
			rootDir,
			workspaceId: "workspace-a",
			workspacePath: "/tmp/project-a",
			card: createCard(summary.taskId),
			runtimeConfig,
			summary,
			now: 21_000,
		});
		await recordModelPerformanceObservation({
			rootDir,
			workspaceId: "workspace-a",
			workspacePath: "/tmp/project-a",
			card: createCard(summary.taskId),
			runtimeConfig,
			summary: createSummary({
				state: "interrupted",
				reviewReason: "interrupted",
				updatedAt: 13_000,
				warningMessage: "Stopped by operator",
			}),
			now: 21_500,
		});
		await recordModelPerformanceObservation({
			rootDir,
			workspaceId: "workspace-b",
			workspacePath: "/tmp/project-b",
			card: createCard("review-task"),
			runtimeConfig,
			summary: createSummary({
				taskId: "review-task",
				updatedAt: 12_000,
				providerId: "lmstudio",
				modelId: "deepseek-coder",
				reviewReason: "error",
				warningMessage: "Needs operator review",
			}),
			now: 22_000,
		});

		const allStats = await readModelPerformanceStats({ rootDir, now: 30_000 });
		expect(allStats.observations).toHaveLength(2);
		expect(allStats.aggregates.some((aggregate) => aggregate.scope === "overall" && aggregate.runs === 1)).toBe(true);
		expect(
			allStats.aggregates.some(
				(aggregate) =>
					aggregate.scope === "project" &&
					aggregate.projectName === "project-a" &&
					aggregate.role === "worker" &&
					aggregate.runs === 1 &&
					aggregate.interruptedRuns === 1,
			),
		).toBe(true);
		expect(
			allStats.aggregates.some(
				(aggregate) =>
					aggregate.scope === "project" &&
					aggregate.projectName === "project-b" &&
					aggregate.role === "reviewer" &&
					aggregate.awaitingReviewRuns === 1,
			),
		).toBe(true);

		const scopedStats = await readModelPerformanceStats({
			rootDir,
			workspacePath: "/tmp/project-a",
			now: 30_000,
		});
		expect(scopedStats.observations).toHaveLength(1);
		expect(scopedStats.observations[0]?.projectName).toBe("project-a");
	});

	it("rolls up a model scope per canonical identity, deduping loopback endpoint spellings (todo §5.Q)", async () => {
		const rootDir = await createStatsRoot();
		const runtimeConfig = createRuntimeConfig();
		// Same model + same logical local server, addressed two ways. They must collapse into ONE model row.
		await recordModelPerformanceObservation({
			rootDir,
			workspaceId: "workspace-a",
			workspacePath: "/tmp/project-a",
			card: createCard("task-localhost"),
			runtimeConfig,
			summary: createSummary({ taskId: "task-localhost", endpoint: "http://localhost:11434/" }),
			now: 20_000,
		});
		await recordModelPerformanceObservation({
			rootDir,
			workspaceId: "workspace-b",
			workspacePath: "/tmp/project-b",
			card: createCard("task-loopback-ip"),
			runtimeConfig,
			summary: createSummary({ taskId: "task-loopback-ip", endpoint: "http://127.0.0.1:11434" }),
			now: 21_000,
		});

		const allStats = await readModelPerformanceStats({ rootDir, now: 30_000 });
		const modelRows = allStats.aggregates.filter((aggregate) => aggregate.scope === "model");
		expect(modelRows).toHaveLength(1);
		expect(modelRows[0]).toMatchObject({
			providerId: "ollama",
			modelId: "qwen2.5-coder",
			endpoint: "http://localhost:11434",
			runs: 2,
			completedRuns: 2,
			role: "unknown",
		});
		// Timing is recomputed from the raw observations (both wall times are 10_000ms here).
		expect(modelRows[0]?.averageWallTimeMs).toBe(10_000);
	});

	it("keeps the same repeated task id distinct across workspaces (dev-test ids collide otherwise)", async () => {
		const rootDir = await createStatsRoot();
		const runtimeConfig = createRuntimeConfig();
		// Dev-test scenarios reuse the same task id (e.g. `dev-habit-insights-mid`) across projects.
		// A task-id-only cache key would dedup these two distinct runs into one.
		const sharedSummary = createSummary({ taskId: "dev-habit-insights-mid" });
		const first = buildModelPerformanceObservation({
			workspaceId: "workspace-a",
			workspacePath: "/tmp/project-a",
			card: createCard(sharedSummary.taskId),
			runtimeConfig,
			summary: sharedSummary,
			now: 20_000,
		});
		const second = buildModelPerformanceObservation({
			workspaceId: "workspace-b",
			workspacePath: "/tmp/project-b",
			card: createCard(sharedSummary.taskId),
			runtimeConfig,
			summary: { ...sharedSummary, workspacePath: "/tmp/project-b" },
			now: 20_000,
		});
		expect(first?.id).toBeTruthy();
		expect(first?.id).not.toBe(second?.id);

		await recordModelPerformanceObservation({
			rootDir,
			workspaceId: "workspace-a",
			workspacePath: "/tmp/project-a",
			card: createCard(sharedSummary.taskId),
			runtimeConfig,
			summary: sharedSummary,
			now: 20_000,
		});
		await recordModelPerformanceObservation({
			rootDir,
			workspaceId: "workspace-b",
			workspacePath: "/tmp/project-b",
			card: createCard(sharedSummary.taskId),
			runtimeConfig,
			summary: { ...sharedSummary, workspacePath: "/tmp/project-b" },
			now: 20_000,
		});

		const allStats = await readModelPerformanceStats({ rootDir, now: 30_000 });
		expect(allStats.observations).toHaveLength(2);
		const scopedToA = await readModelPerformanceStats({ rootDir, workspacePath: "/tmp/project-a", now: 30_000 });
		expect(scopedToA.observations).toHaveLength(1);
		expect(scopedToA.observations[0]?.projectName).toBe("project-a");
		expect(
			allStats.aggregates.filter((aggregate) => aggregate.scope === "project" && aggregate.runs === 1),
		).toHaveLength(2);
	});
});
