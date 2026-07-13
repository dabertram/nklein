import { DEFAULT_AGENT_RULESETS_CONFIG, DEFAULT_RUNTIME_SWARM_GUARDRAILS } from "@runtime-contract";
import { afterEach, describe, expect, it } from "vitest";
import { swarmGuardrailsToInputs } from "@/components/runtime-settings-swarm-guardrails";
import {
	initSettingsDraftFromConfig,
	isSettingsDraftDirty,
	readBooleanTaskDefault,
	readTaskAutoReviewModeDefault,
	type SettingsConfigSnapshot,
	type SettingsDirtyArgs,
	type SettingsDraft,
	type SettingsLocalDraft,
	snapshotSwarmGuardrailInputs,
} from "@/features/settings/settings-draft";
import type { RuntimeConfigResponse } from "@/runtime/types";
import { LocalStorageKey } from "@/storage/local-storage-store";

/** Representative config covering every field group the draft is seeded from. */
const representativeConfig = {
	selectedAgentId: "claude",
	agentAutonomousModeEnabled: false,
	agentTimeoutMode: "long",
	agentTimeoutProfile: "cloud",
	requestTimeoutMs: 120_000,
	streamTimeoutMs: null,
	toolTimeoutMs: 30_000,
	agentTimeoutMs: null,
	conversationTimeoutMs: 900_000,
	maxAgentWritableFileLines: 1500,
	maxConcurrentTasks: 5,
	workspaceBaseDir: "/tmp/workspaces",
	sandboxEgressProxyEnabled: true,
	sandboxEgressAllowlist: "api.github.com,pkg.example.org",
	sandboxMaxContainers: 4,
	sandboxAgentsPerContainer: 1,
	sandboxMemoryPerContainerMb: 4096,
	sandboxCpusPerContainer: 2.5,
	sandboxIdleTimeoutMinutes: 20,
	sandboxIsolationProfileDefault: "strict_per_agent",
	lostHeartbeatPolicy: "fail",
	decompositionAutoApplyEnabled: false,
	testDrivenModeEnabled: true,
	testDrivenModeOverride: null,
	effectiveTestDrivenMode: true,
	hardTaskRoutingMode: "wait_for_best",
	secondOpinionReviewEnabled: false,
	reviewMaxRounds: 7,
	speculativeBestOfNEnabled: false,
	speculativeMaxConcurrentSpecs: 2,
	speculativeMaxSpecsPerRun: 4,
	swarmGuardrails: DEFAULT_RUNTIME_SWARM_GUARDRAILS,
	developerModeEnabled: true,
	replayCardsEnabled: true,
	knowsTodayEnabled: true,
	retrievalEgressEnabled: true,
	retrievalSearchBackendUrl: "http://127.0.0.1:8080",
	llmfitCatalogUpdateMode: "auto",
	sandboxMcpServersEnabled: false,
	capabilityBrokerEnabled: true,
	basicMemoryEnabled: true,
	chatAdaptiveTruncationEnabled: false,
	reasoningBudgetEnabled: true,
	reviewLensesEnabled: true,
	readyForReviewNotificationsEnabled: false,
	codeEmbeddingDefaults: { provider: "openai_compatible", model: "embed-1", baseUrl: "http://127.0.0.1:1234/v1" },
	codeEmbeddingOverride: null,
	shortcuts: [{ label: "Deploy", command: "deploy", icon: null }],
	maxConcurrentTasksOverride: 2,
	selectedAgentIdOverride: "nklein",
	modelRoles: { worker: { providerId: "lmstudio", modelId: "qwen3-8b" } },
	concurrencyDefaults: { perProvider: { lmstudio: 2 }, perModel: {}, perHost: {}, perEndpoint: {} },
	modelSuitabilityPolicyDefaults: { onUnsuitable: "warn", onUnknown: "reject" },
	skillDynamicsLevelDefault: "assigned_skills",
	skillDynamicsLevelOverride: "fully_static",
	concurrencyOverride: { perProvider: {}, perModel: { "qwen3-8b": 1 }, perHost: {}, perEndpoint: {} },
	agentRulesets: { capability: { globalPreset: "strict" }, delivery: { globalPreset: "strict" } },
	modelRolesOverride: { reviewer: { modelId: "qwen3-14b" } },
	agentRulesetsOverride: null,
	commitPromptTemplate: "Commit template",
	openPrPromptTemplate: "PR template",
} as unknown as RuntimeConfigResponse;

function draftFromSnapshot(snapshot: SettingsConfigSnapshot): SettingsDraft {
	const { swarmGuardrails, ...common } = snapshot;
	return { ...common, swarmGuardrailInputs: swarmGuardrailsToInputs(swarmGuardrails) };
}

const cleanLocal: SettingsLocalDraft = {
	taskDefaultStartInPlanMode: false,
	taskDefaultAutoReviewEnabled: false,
	taskDefaultAutoReviewMode: "commit",
	themeId: "default",
};

function dirtyArgs(snapshot: SettingsConfigSnapshot, overrides?: Partial<SettingsDirtyArgs>): SettingsDirtyArgs {
	return {
		draft: draftFromSnapshot(snapshot),
		snapshot,
		local: cleanLocal,
		localInitial: cleanLocal,
		nkleinSettingsDirty: false,
		nkleinMcpSettingsDirty: false,
		...overrides,
	};
}

describe("initSettingsDraftFromConfig", () => {
	it("seeds every field with the dialog defaults when no config is loaded", () => {
		const snapshot = initSettingsDraftFromConfig(null, { cloudProviderSupportEnabled: false });
		expect(snapshot.selectedAgentId).toBe("nklein");
		expect(snapshot.agentAutonomousModeEnabled).toBe(true);
		expect(snapshot.agentTimeoutMode).toBe("normal");
		expect(snapshot.agentTimeoutProfile).toBe("local");
		expect(snapshot.requestTimeoutMs).toBe("");
		expect(snapshot.maxAgentWritableFileLines).toBe("1000");
		expect(snapshot.maxConcurrentTasks).toBe("3");
		expect(snapshot.workspaceBaseDir).toBe("");
		expect(snapshot.sandboxEgressProxyEnabled).toBe(false);
		expect(snapshot.sandboxEgressAllowlist).toBe("");
		expect(snapshot.sandboxMaxContainers).toBe("1");
		expect(snapshot.sandboxAgentsPerContainer).toBe("0");
		expect(snapshot.sandboxMemoryPerContainerMb).toBe("2048");
		expect(snapshot.sandboxCpusPerContainer).toBe("2");
		expect(snapshot.sandboxIdleTimeoutMinutes).toBe("10");
		expect(snapshot.sandboxIsolationProfileDefault).toBe("lean_shared");
		expect(snapshot.lostHeartbeatPolicy).toBe("park");
		expect(snapshot.decompositionAutoApplyEnabled).toBe(true);
		expect(snapshot.testDrivenModeEnabled).toBe(false);
		expect(snapshot.hardTaskRoutingMode).toBe("attempt_with_available");
		expect(snapshot.secondOpinionReviewEnabled).toBe(true);
		expect(snapshot.reviewMaxRounds).toBe(20);
		expect(snapshot.speculativeBestOfNEnabled).toBe(true);
		expect(snapshot.speculativeMaxConcurrentSpecs).toBe(1);
		expect(snapshot.speculativeMaxSpecsPerRun).toBe(3);
		expect(snapshot.swarmGuardrails).toEqual(DEFAULT_RUNTIME_SWARM_GUARDRAILS);
		expect(snapshot.developerModeEnabled).toBe(false);
		expect(snapshot.retrievalEgressEnabled).toBe(false);
		expect(snapshot.retrievalSearchBackendUrl).toBe("");
		expect(snapshot.llmfitCatalogUpdateMode).toBe("notify");
		expect(snapshot.sandboxMcpServersEnabled).toBe(true);
		expect(snapshot.capabilityBrokerEnabled).toBe(false);
		expect(snapshot.basicMemoryEnabled).toBe(false);
		expect(snapshot.chatAdaptiveTruncationEnabled).toBe(true);
		expect(snapshot.reasoningBudgetEnabled).toBe(false);
		expect(snapshot.reviewLensesEnabled).toBe(false);
		expect(snapshot.readyForReviewNotificationsEnabled).toBe(true);
		expect(snapshot.codeEmbeddingDefaults).toEqual({
			provider: "local_lexical",
			model: "kanban-local-lexical-vector-v1",
			baseUrl: null,
		});
		expect(snapshot.codeEmbeddingOverride).toBeNull();
		expect(snapshot.shortcuts).toEqual([]);
		expect(snapshot.maxConcurrentTasksOverride).toBeNull();
		expect(snapshot.selectedAgentIdOverride).toBeNull();
		expect(snapshot.modelRoles).toEqual({});
		expect(snapshot.concurrencyDefaults).toEqual({ perProvider: {}, perModel: {}, perHost: {}, perEndpoint: {} });
		expect(snapshot.modelGateUnsuitable).toBe("reject");
		expect(snapshot.modelGateUnknown).toBe("warn");
		expect(snapshot.skillDynamicsLevel).toBe("fully_dynamic");
		expect(snapshot.skillDynamicsLevelOverride).toBeNull();
		expect(snapshot.concurrencyOverride).toBeNull();
		expect(snapshot.agentRulesets).toEqual(DEFAULT_AGENT_RULESETS_CONFIG);
		expect(snapshot.modelRolesOverride).toBeNull();
		expect(snapshot.agentRulesetsOverride).toBeNull();
		expect(snapshot.commitPromptTemplate).toBe("");
		expect(snapshot.openPrPromptTemplate).toBe("");
	});

	it("maps a loaded config onto the draft shape (numbers as strings, null timeouts blank)", () => {
		const snapshot = initSettingsDraftFromConfig(representativeConfig, { cloudProviderSupportEnabled: true });
		expect(snapshot.selectedAgentId).toBe("claude");
		expect(snapshot.agentTimeoutMode).toBe("long");
		expect(snapshot.agentTimeoutProfile).toBe("cloud");
		expect(snapshot.requestTimeoutMs).toBe("120000");
		expect(snapshot.streamTimeoutMs).toBe("");
		expect(snapshot.toolTimeoutMs).toBe("30000");
		expect(snapshot.agentTimeoutMs).toBe("");
		expect(snapshot.conversationTimeoutMs).toBe("900000");
		expect(snapshot.maxAgentWritableFileLines).toBe("1500");
		expect(snapshot.maxConcurrentTasks).toBe("5");
		expect(snapshot.workspaceBaseDir).toBe("/tmp/workspaces");
		expect(snapshot.sandboxEgressProxyEnabled).toBe(true);
		expect(snapshot.sandboxEgressAllowlist).toBe("api.github.com,pkg.example.org");
		expect(snapshot.sandboxMaxContainers).toBe("4");
		expect(snapshot.sandboxAgentsPerContainer).toBe("1");
		expect(snapshot.sandboxMemoryPerContainerMb).toBe("4096");
		expect(snapshot.sandboxCpusPerContainer).toBe("2.5");
		expect(snapshot.sandboxIdleTimeoutMinutes).toBe("20");
		expect(snapshot.sandboxIsolationProfileDefault).toBe("strict_per_agent");
		expect(snapshot.lostHeartbeatPolicy).toBe("fail");
		expect(snapshot.hardTaskRoutingMode).toBe("wait_for_best");
		expect(snapshot.reviewMaxRounds).toBe(7);
		expect(snapshot.retrievalSearchBackendUrl).toBe("http://127.0.0.1:8080");
		expect(snapshot.llmfitCatalogUpdateMode).toBe("auto");
		expect(snapshot.codeEmbeddingDefaults).toEqual({
			provider: "openai_compatible",
			model: "embed-1",
			baseUrl: "http://127.0.0.1:1234/v1",
		});
		expect(snapshot.maxConcurrentTasksOverride).toBe(2);
		expect(snapshot.selectedAgentIdOverride).toBe("nklein");
		expect(snapshot.modelRoles).toEqual({ worker: { providerId: "lmstudio", modelId: "qwen3-8b" } });
		expect(snapshot.concurrencyDefaults).toEqual({
			perProvider: { lmstudio: 2 },
			perModel: {},
			perHost: {},
			perEndpoint: {},
		});
		expect(snapshot.modelGateUnsuitable).toBe("warn");
		expect(snapshot.modelGateUnknown).toBe("reject");
		expect(snapshot.skillDynamicsLevel).toBe("assigned_skills");
		expect(snapshot.skillDynamicsLevelOverride).toBe("fully_static");
		expect(snapshot.concurrencyOverride).toEqual({
			perProvider: {},
			perModel: { "qwen3-8b": 1 },
			perHost: {},
			perEndpoint: {},
		});
		expect(snapshot.modelRolesOverride).toEqual({ reviewer: { modelId: "qwen3-14b" } });
		expect(snapshot.commitPromptTemplate).toBe("Commit template");
		expect(snapshot.openPrPromptTemplate).toBe("PR template");
	});

	it("forces the local-only agent and timeout profile when cloud provider support is disabled", () => {
		const snapshot = initSettingsDraftFromConfig(representativeConfig, { cloudProviderSupportEnabled: false });
		expect(snapshot.selectedAgentId).toBe("nklein");
		expect(snapshot.agentTimeoutProfile).toBe("local");
	});

	it("clones concurrency maps so draft edits cannot alias the config response", () => {
		const snapshot = initSettingsDraftFromConfig(representativeConfig, { cloudProviderSupportEnabled: true });
		expect(snapshot.concurrencyDefaults.perProvider).not.toBe(representativeConfig.concurrencyDefaults?.perProvider);
		expect(snapshot.concurrencyOverride?.perModel).not.toBe(representativeConfig.concurrencyOverride?.perModel);
	});

	it("converts snapshot guardrails to form inputs for the reset path", () => {
		const snapshot = initSettingsDraftFromConfig(null, { cloudProviderSupportEnabled: false });
		expect(snapshotSwarmGuardrailInputs(snapshot)).toEqual(swarmGuardrailsToInputs(DEFAULT_RUNTIME_SWARM_GUARDRAILS));
	});
});

describe("isSettingsDraftDirty", () => {
	const snapshot = initSettingsDraftFromConfig(representativeConfig, { cloudProviderSupportEnabled: true });

	it("is clean for a draft freshly seeded from the snapshot", () => {
		expect(isSettingsDraftDirty(dirtyArgs(snapshot))).toBe(false);
		const emptySnapshot = initSettingsDraftFromConfig(null, { cloudProviderSupportEnabled: false });
		expect(isSettingsDraftDirty(dirtyArgs(emptySnapshot))).toBe(false);
	});

	it("ignores surrounding whitespace on numeric text inputs", () => {
		const draft = { ...draftFromSnapshot(snapshot), maxConcurrentTasks: "  5  ", requestTimeoutMs: " 120000 " };
		expect(isSettingsDraftDirty(dirtyArgs(snapshot, { draft }))).toBe(false);
	});

	it("normalizes prompt templates (CRLF + surrounding whitespace) before comparing", () => {
		const draft = { ...draftFromSnapshot(snapshot), commitPromptTemplate: "Commit template\r\n" };
		expect(isSettingsDraftDirty(dirtyArgs(snapshot, { draft }))).toBe(false);
		const changed = { ...draftFromSnapshot(snapshot), commitPromptTemplate: "Commit template edited" };
		expect(isSettingsDraftDirty(dirtyArgs(snapshot, { draft: changed }))).toBe(true);
	});

	it("flags each field group when it diverges from the snapshot", () => {
		const base = draftFromSnapshot(snapshot);
		const mutations: Array<Partial<SettingsDraft>> = [
			{ selectedAgentId: "nklein" },
			{ agentAutonomousModeEnabled: true },
			{ agentTimeoutMode: "unlimited" },
			{ agentTimeoutProfile: "custom" },
			{ requestTimeoutMs: "999" },
			{ maxAgentWritableFileLines: "2000" },
			{ maxConcurrentTasks: "9" },
			{ workspaceBaseDir: "/elsewhere" },
			{ sandboxEgressProxyEnabled: false },
			{ sandboxEgressAllowlist: "changed.example.com" },
			{ sandboxMaxContainers: "8" },
			{ sandboxAgentsPerContainer: "3" },
			{ sandboxMemoryPerContainerMb: "8192" },
			{ sandboxCpusPerContainer: "4" },
			{ sandboxIdleTimeoutMinutes: "60" },
			{ sandboxIsolationProfileDefault: "lean_shared" },
			{ lostHeartbeatPolicy: "park" },
			{ decompositionAutoApplyEnabled: true },
			{ testDrivenModeEnabled: false },
			{ hardTaskRoutingMode: "attempt_with_available" },
			{ secondOpinionReviewEnabled: true },
			{ reviewMaxRounds: 8 },
			{ speculativeBestOfNEnabled: true },
			{ speculativeMaxConcurrentSpecs: 3 },
			{ speculativeMaxSpecsPerRun: 5 },
			{ developerModeEnabled: false },
			{ replayCardsEnabled: false },
			{ knowsTodayEnabled: false },
			{ retrievalEgressEnabled: false },
			{ retrievalSearchBackendUrl: "http://other" },
			{ llmfitCatalogUpdateMode: "notify" },
			{ sandboxMcpServersEnabled: true },
			{ capabilityBrokerEnabled: false },
			{ basicMemoryEnabled: false },
			{ chatAdaptiveTruncationEnabled: true },
			{ reasoningBudgetEnabled: false },
			{ reviewLensesEnabled: false },
			{ readyForReviewNotificationsEnabled: true },
			{
				codeEmbeddingDefaults: {
					provider: "local_lexical",
					model: "kanban-local-lexical-vector-v1",
					baseUrl: null,
				},
			},
			{
				codeEmbeddingOverride: {
					provider: "openai_compatible",
					model: "override-embed",
					baseUrl: "http://127.0.0.1:9999",
				},
			},
			{ shortcuts: [] },
			{ maxConcurrentTasksOverride: null },
			{ selectedAgentIdOverride: null },
			{ modelRoles: { worker: { providerId: "lmstudio", modelId: "other-model" } } },
			{ concurrencyDefaults: { perProvider: { lmstudio: 3 }, perModel: {}, perHost: {}, perEndpoint: {} } },
			{ modelGateUnsuitable: "reject" },
			{ modelGateUnknown: "warn" },
			{ skillDynamicsLevel: "fully_dynamic" },
			{ skillDynamicsLevelOverride: null },
			{ concurrencyOverride: null },
			{ agentRulesetsOverride: DEFAULT_AGENT_RULESETS_CONFIG },
			{ commitPromptTemplate: "changed" },
			{ openPrPromptTemplate: "changed" },
		];
		for (const mutation of mutations) {
			const draft = { ...base, ...mutation };
			expect(isSettingsDraftDirty(dirtyArgs(snapshot, { draft })), JSON.stringify(mutation)).toBe(true);
		}
	});

	it("treats a cleared model-roles override ({} vs null) as a change", () => {
		const clearedOverride = { ...draftFromSnapshot(snapshot), modelRolesOverride: null };
		expect(isSettingsDraftDirty(dirtyArgs(snapshot, { draft: clearedOverride }))).toBe(true);
		const emptyObjectOverride = { ...draftFromSnapshot(snapshot), modelRolesOverride: {} };
		expect(isSettingsDraftDirty(dirtyArgs(snapshot, { draft: emptyObjectOverride }))).toBe(true);
	});

	it("flags guardrail input edits via their structured equivalence", () => {
		const base = draftFromSnapshot(snapshot);
		const inputs = { ...base.swarmGuardrailInputs, maxAutonomousTurnsPerTask: "999" };
		expect(isSettingsDraftDirty(dirtyArgs(snapshot, { draft: { ...base, swarmGuardrailInputs: inputs } }))).toBe(
			true,
		);
	});

	it("flags localStorage-backed task defaults and theme changes", () => {
		expect(
			isSettingsDraftDirty(dirtyArgs(snapshot, { local: { ...cleanLocal, taskDefaultStartInPlanMode: true } })),
		).toBe(true);
		expect(
			isSettingsDraftDirty(dirtyArgs(snapshot, { local: { ...cleanLocal, taskDefaultAutoReviewMode: "pr" } })),
		).toBe(true);
		expect(isSettingsDraftDirty(dirtyArgs(snapshot, { local: { ...cleanLocal, themeId: "midnight" } }))).toBe(true);
	});

	it("bubbles the external !Klein controller dirty flags", () => {
		expect(isSettingsDraftDirty(dirtyArgs(snapshot, { nkleinSettingsDirty: true }))).toBe(true);
		expect(isSettingsDraftDirty(dirtyArgs(snapshot, { nkleinMcpSettingsDirty: true }))).toBe(true);
	});
});

describe("localStorage-backed task defaults", () => {
	afterEach(() => {
		window.localStorage.clear();
	});

	it("readBooleanTaskDefault only honors literal true/false", () => {
		expect(readBooleanTaskDefault(LocalStorageKey.TaskStartInPlanMode, false)).toBe(false);
		expect(readBooleanTaskDefault(LocalStorageKey.TaskStartInPlanMode, true)).toBe(true);
		window.localStorage.setItem(LocalStorageKey.TaskStartInPlanMode, "true");
		expect(readBooleanTaskDefault(LocalStorageKey.TaskStartInPlanMode, false)).toBe(true);
		window.localStorage.setItem(LocalStorageKey.TaskStartInPlanMode, "false");
		expect(readBooleanTaskDefault(LocalStorageKey.TaskStartInPlanMode, true)).toBe(false);
		window.localStorage.setItem(LocalStorageKey.TaskStartInPlanMode, "yes");
		expect(readBooleanTaskDefault(LocalStorageKey.TaskStartInPlanMode, true)).toBe(true);
	});

	it("readTaskAutoReviewModeDefault falls back to commit", () => {
		expect(readTaskAutoReviewModeDefault()).toBe("commit");
		window.localStorage.setItem(LocalStorageKey.TaskAutoReviewMode, "pr");
		expect(readTaskAutoReviewModeDefault()).toBe("pr");
		window.localStorage.setItem(LocalStorageKey.TaskAutoReviewMode, "bogus");
		expect(readTaskAutoReviewModeDefault()).toBe("commit");
	});
});
