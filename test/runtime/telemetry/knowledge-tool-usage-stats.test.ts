import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import type { RuntimeBoardCard, RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import {
	buildKnowledgeToolUsageObservation,
	classifyKnowledgeTool,
	readKnowledgeToolUsageStats,
	recordKnowledgeToolUsageObservation,
} from "../../../src/telemetry/knowledge-tool-usage-stats";

async function createStatsRoot(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "nklein-knowledge-tool-usage-"));
}

function createRuntimeConfig(): RuntimeConfigState {
	return {
		globalConfigPath: "/tmp/global.json",
		projectConfigPath: "/tmp/project.json",
		selectedAgentId: "nklein",
		selectedShortcutLabel: null,
		developerModeEnabled: true,
		replayCardsEnabled: true,
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
		sandboxMaxContainers: 1,
		sandboxAgentsPerContainer: 0,
		sandboxMemoryPerContainerMb: 2048,
		sandboxCpusPerContainer: 2,
		sandboxIdleTimeoutMinutes: 10,
		lostHeartbeatPolicy: "park",
		decompositionAutoApplyEnabled: true,
		secondOpinionReviewEnabled: true,
		reviewMaxRounds: 20,
		readyForReviewNotificationsEnabled: true,
		codeEmbeddingDefaults: { provider: "local_lexical", model: null, baseUrl: null },
		codeEmbeddingOverride: null,
		effectiveCodeEmbeddingSettings: { provider: "local_lexical", model: null, baseUrl: null },
		modelRoles: {
			worker: { providerId: "ollama", modelId: "qwen2.5-coder" },
		},
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
		title: "Inspect audio synthesis",
		prompt: "Use knowledge tools before implementing the synth.",
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 100,
		updatedAt: 100,
	};
}

function createSummary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "audio-synth",
		state: "running",
		mode: "act",
		agentId: "nklein",
		workspacePath: "/tmp/audio-project",
		pid: null,
		startedAt: 1_000,
		updatedAt: 3_000,
		lastOutputAt: 3_000,
		lastTokenAt: 2_000,
		lastHeartbeatAt: 3_000,
		heartbeatStatus: "healthy",
		providerId: "ollama",
		modelId: "qwen2.5-coder",
		endpoint: "http://127.0.0.1:11434",
		sharedEndpointId: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: 2_500,
		latestHookActivity: {
			activityText: "Completed search_code(oscillator phase alignment)",
			toolName: "search_code",
			toolInputSummary: "oscillator phase alignment",
			finalMessage: null,
			hookEventName: "tool_result",
			notificationType: null,
			source: "nklein-sdk",
		},
		warningMessage: null,
		latestUsage: null,
		contextBudgetBreakdown: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...overrides,
	};
}

describe("knowledge tool usage stats", () => {
	it("classifies retrieval, index, knowledge, and external fetch tools", () => {
		expect(classifyKnowledgeTool("search_code")).toBe("code_index");
		expect(classifyKnowledgeTool("repo_map")).toBe("code_index");
		expect(classifyKnowledgeTool("find_files")).toBe("file_discovery");
		expect(classifyKnowledgeTool("read_large_file")).toBe("file_read");
		expect(classifyKnowledgeTool("fetch_web_content")).toBe("external_fetch");
		expect(classifyKnowledgeTool("search_architecture_knowledge")).toBe("architecture_knowledge");
	});

	it("builds project-scoped tool observations from NKlein hook activity", () => {
		const observation = buildKnowledgeToolUsageObservation({
			workspaceId: "workspace-a",
			workspacePath: "/tmp/audio-project",
			card: createCard("audio-synth"),
			runtimeConfig: createRuntimeConfig(),
			summary: createSummary(),
			now: 4_000,
		});

		expect(observation).toMatchObject({
			recordedAt: 4_000,
			projectName: "audio-project",
			taskTitle: "Inspect audio synthesis",
			role: "worker",
			providerId: "ollama",
			modelId: "qwen2.5-coder",
			toolName: "search_code",
			toolCategory: "code_index",
			outcome: "succeeded",
		});
	});

	it("deduplicates repeated emissions and aggregates by project, version, role, model, and tool", async () => {
		const rootDir = await createStatsRoot();
		const runtimeConfig = createRuntimeConfig();
		const summary = createSummary();
		await recordKnowledgeToolUsageObservation({
			rootDir,
			workspaceId: "workspace-a",
			workspacePath: "/tmp/audio-project",
			card: createCard(summary.taskId),
			runtimeConfig,
			summary,
			now: 4_000,
		});
		await recordKnowledgeToolUsageObservation({
			rootDir,
			workspaceId: "workspace-a",
			workspacePath: "/tmp/audio-project",
			card: createCard(summary.taskId),
			runtimeConfig,
			summary,
			now: 5_000,
		});
		await recordKnowledgeToolUsageObservation({
			rootDir,
			workspaceId: "workspace-a",
			workspacePath: "/tmp/audio-project",
			card: createCard(summary.taskId),
			runtimeConfig,
			summary: createSummary({
				lastHookAt: 6_000,
				latestHookActivity: {
					activityText: "Failed fetch_web_content(psytrance kick bass phase alignment)",
					toolName: "fetch_web_content",
					toolInputSummary: "psytrance kick bass phase alignment",
					finalMessage: null,
					hookEventName: "tool_result",
					notificationType: null,
					source: "nklein-sdk",
				},
			}),
			now: 6_000,
		});

		const stats = await readKnowledgeToolUsageStats({ rootDir, workspacePath: "/tmp/audio-project", now: 7_000 });

		expect(stats.observations).toHaveLength(2);
		expect(
			stats.aggregates.some(
				(aggregate) =>
					aggregate.scope === "project" &&
					aggregate.projectName === "audio-project" &&
					aggregate.toolName === "search_code" &&
					aggregate.calls === 1 &&
					aggregate.succeededCalls === 1,
			),
		).toBe(true);
		expect(
			stats.aggregates.some(
				(aggregate) =>
					aggregate.scope === "project" &&
					aggregate.toolCategory === "external_fetch" &&
					aggregate.failedCalls === 1,
			),
		).toBe(true);
	});

	it("keeps the same repeated task id distinct across workspaces (dev-test ids collide otherwise)", async () => {
		const rootDir = await createStatsRoot();
		const runtimeConfig = createRuntimeConfig();
		// Dev-test scenarios reuse the same task id across projects; a task-id-only key would merge them.
		const sharedSummary = createSummary({ taskId: "dev-audio-vst-complex" });
		const first = buildKnowledgeToolUsageObservation({
			workspaceId: "workspace-a",
			workspacePath: "/tmp/audio-project-a",
			card: createCard(sharedSummary.taskId),
			runtimeConfig,
			summary: { ...sharedSummary, workspacePath: "/tmp/audio-project-a" },
			now: 4_000,
		});
		const second = buildKnowledgeToolUsageObservation({
			workspaceId: "workspace-b",
			workspacePath: "/tmp/audio-project-b",
			card: createCard(sharedSummary.taskId),
			runtimeConfig,
			summary: { ...sharedSummary, workspacePath: "/tmp/audio-project-b" },
			now: 4_000,
		});
		expect(first?.id).toBeTruthy();
		expect(first?.id).not.toBe(second?.id);

		await recordKnowledgeToolUsageObservation({
			rootDir,
			workspaceId: "workspace-a",
			workspacePath: "/tmp/audio-project-a",
			card: createCard(sharedSummary.taskId),
			runtimeConfig,
			summary: { ...sharedSummary, workspacePath: "/tmp/audio-project-a" },
			now: 4_000,
		});
		await recordKnowledgeToolUsageObservation({
			rootDir,
			workspaceId: "workspace-b",
			workspacePath: "/tmp/audio-project-b",
			card: createCard(sharedSummary.taskId),
			runtimeConfig,
			summary: { ...sharedSummary, workspacePath: "/tmp/audio-project-b" },
			now: 4_000,
		});

		const allStats = await readKnowledgeToolUsageStats({ rootDir, now: 7_000 });
		expect(allStats.observations).toHaveLength(2);
		const scopedToA = await readKnowledgeToolUsageStats({
			rootDir,
			workspacePath: "/tmp/audio-project-a",
			now: 7_000,
		});
		expect(scopedToA.observations).toHaveLength(1);
		expect(scopedToA.observations[0]?.projectName).toBe("audio-project-a");
	});
});
