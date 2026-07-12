// Settings draft behavior model (todo §5.AK) — the typed draft state behind the runtime settings
// dialog: how the draft is seeded/reset from a RuntimeConfigResponse and what makes it dirty.
// This module owns BEHAVIOR only; the dialog (runtime-settings-dialog.tsx) stays composition/JSX.
import {
	areRuntimeSwarmGuardrailsEqual,
	DEFAULT_AGENT_RULESETS_CONFIG,
	DEFAULT_RUNTIME_SWARM_GUARDRAILS,
} from "@runtime-contract";
import { areRuntimeProjectShortcutsEqual } from "@runtime-shortcuts";
import { areCodeEmbeddingSettingsEqual, LOCAL_CODE_EMBEDDING_MODEL } from "@/components/code-embedding-fields";
import type { ConcurrencyMap } from "@/components/concurrency-editor";
import {
	normalizeAgentTimeoutProfile,
	normalizeTemplateForComparison,
} from "@/components/runtime-settings-dialog-helpers";
import { normalizeModelRolesForSettings, serializeModelRoles } from "@/components/runtime-settings-model-roles";
import {
	inputsToSwarmGuardrails,
	type SwarmGuardrailInputs,
	swarmGuardrailsToInputs,
} from "@/components/runtime-settings-swarm-guardrails";
import type { ThemeId } from "@/hooks/use-theme";
import type {
	AgentRulesetsConfigPayload,
	RuntimeAgentId,
	RuntimeCodeEmbeddingSettings,
	RuntimeConfigResponse,
	RuntimeLlmfitCatalogUpdateMode,
	RuntimeLostHeartbeatPolicy,
	RuntimeModelGateAction,
	RuntimeModelRoles,
	RuntimeProjectShortcut,
	RuntimeSandboxIsolationProfile,
	RuntimeSkillDynamicsLevel,
	RuntimeSwarmGuardrails,
	RuntimeTaskAutoReviewMode,
} from "@/runtime/types";
import { LocalStorageKey, readLocalStorageItem } from "@/storage/local-storage-store";

export type SettingsAgentTimeoutMode = "normal" | "long" | "extended" | "unlimited";
export type SettingsAgentTimeoutProfile = "cloud" | "local" | "custom";
export type SettingsHardTaskRoutingMode = "wait_for_best" | "attempt_with_available";

export interface SettingsConcurrencyDraft {
	perProvider: ConcurrencyMap;
	perModel: ConcurrencyMap;
	perHost: ConcurrencyMap;
	perEndpoint: ConcurrencyMap;
}

/**
 * Fields shared by the editable draft and the config-derived snapshot. Numeric inputs are kept as the
 * raw strings the dialog edits (dirty comparison trims them; parsing happens at save time, see
 * settings-save.ts).
 */
interface SettingsDraftCommonFields {
	selectedAgentId: RuntimeAgentId;
	agentAutonomousModeEnabled: boolean;
	agentTimeoutMode: SettingsAgentTimeoutMode;
	agentTimeoutProfile: SettingsAgentTimeoutProfile;
	requestTimeoutMs: string;
	streamTimeoutMs: string;
	toolTimeoutMs: string;
	agentTimeoutMs: string;
	conversationTimeoutMs: string;
	maxAgentWritableFileLines: string;
	maxConcurrentTasks: string;
	workspaceBaseDir: string;
	deviceRamGb: string;
	sandboxMaxContainers: string;
	sandboxAgentsPerContainer: string;
	sandboxMemoryPerContainerMb: string;
	sandboxCpusPerContainer: string;
	sandboxIdleTimeoutMinutes: string;
	sandboxIsolationProfileDefault: RuntimeSandboxIsolationProfile;
	lostHeartbeatPolicy: RuntimeLostHeartbeatPolicy;
	decompositionAutoApplyEnabled: boolean;
	testDrivenModeEnabled: boolean;
	hardTaskRoutingMode: SettingsHardTaskRoutingMode;
	secondOpinionReviewEnabled: boolean;
	reviewMaxRounds: number;
	speculativeBestOfNEnabled: boolean;
	speculativeMaxConcurrentSpecs: number;
	speculativeMaxSpecsPerRun: number;
	developerModeEnabled: boolean;
	replayCardsEnabled: boolean;
	knowsTodayEnabled: boolean;
	retrievalEgressEnabled: boolean;
	retrievalSearchBackendUrl: string;
	llmfitCatalogUpdateMode: RuntimeLlmfitCatalogUpdateMode;
	sandboxMcpServersEnabled: boolean;
	capabilityBrokerEnabled: boolean;
	basicMemoryEnabled: boolean;
	chatAdaptiveTruncationEnabled: boolean;
	reasoningBudgetEnabled: boolean;
	reviewLensesEnabled: boolean;
	readyForReviewNotificationsEnabled: boolean;
	codeEmbeddingDefaults: RuntimeCodeEmbeddingSettings;
	codeEmbeddingOverride: RuntimeCodeEmbeddingSettings | null;
	shortcuts: RuntimeProjectShortcut[];
	maxConcurrentTasksOverride: number | null;
	selectedAgentIdOverride: RuntimeAgentId | null;
	modelRoles: RuntimeModelRoles;
	concurrencyDefaults: SettingsConcurrencyDraft;
	modelGateUnsuitable: RuntimeModelGateAction;
	modelGateUnknown: RuntimeModelGateAction;
	skillDynamicsLevel: RuntimeSkillDynamicsLevel;
	skillDynamicsLevelOverride: RuntimeSkillDynamicsLevel | null;
	concurrencyOverride: SettingsConcurrencyDraft | null;
	agentRulesets: AgentRulesetsConfigPayload;
	modelRolesOverride: RuntimeModelRoles | null;
	agentRulesetsOverride: AgentRulesetsConfigPayload | null;
	commitPromptTemplate: string;
	openPrPromptTemplate: string;
}

/** The dialog's editable draft. Swarm guardrails are held as raw form inputs while editing. */
export interface SettingsDraft extends SettingsDraftCommonFields {
	swarmGuardrailInputs: SwarmGuardrailInputs;
}

/**
 * The values the dialog seeds its local draft state from (and compares against for dirty detection),
 * derived from the runtime config response. Swarm guardrails are held in their structured form; the
 * dialog converts them to form inputs via {@link snapshotSwarmGuardrailInputs} when resetting.
 */
export interface SettingsConfigSnapshot extends SettingsDraftCommonFields {
	swarmGuardrails: RuntimeSwarmGuardrails;
}

export interface SettingsDraftContext {
	cloudProviderSupportEnabled: boolean;
}

const DEFAULT_CODE_EMBEDDING_DEFAULTS: RuntimeCodeEmbeddingSettings = {
	provider: "local_lexical",
	model: LOCAL_CODE_EMBEDDING_MODEL,
	baseUrl: null,
};

function cloneConcurrencyMaps(
	maps:
		| {
				perProvider?: ConcurrencyMap | null;
				perModel?: ConcurrencyMap | null;
				perHost?: ConcurrencyMap | null;
				perEndpoint?: ConcurrencyMap | null;
		  }
		| null
		| undefined,
): SettingsConcurrencyDraft {
	return {
		perProvider: { ...(maps?.perProvider ?? {}) },
		perModel: { ...(maps?.perModel ?? {}) },
		perHost: { ...(maps?.perHost ?? {}) },
		perEndpoint: { ...(maps?.perEndpoint ?? {}) },
	};
}

/**
 * Builds the config-derived snapshot the dialog seeds its draft from — the single source of truth for
 * how each RuntimeConfigResponse field (or its absence) maps onto local draft state, including the
 * per-field fallbacks the dialog has always used.
 */
export function initSettingsDraftFromConfig(
	config: RuntimeConfigResponse | null,
	context: SettingsDraftContext,
): SettingsConfigSnapshot {
	const { cloudProviderSupportEnabled } = context;
	const configuredAgentId = config?.selectedAgentId ?? null;
	return {
		selectedAgentId: cloudProviderSupportEnabled ? (configuredAgentId ?? "nklein") : "nklein",
		agentAutonomousModeEnabled: config?.agentAutonomousModeEnabled ?? true,
		agentTimeoutMode: config?.agentTimeoutMode ?? "normal",
		agentTimeoutProfile: normalizeAgentTimeoutProfile(config?.agentTimeoutProfile, cloudProviderSupportEnabled),
		requestTimeoutMs: config?.requestTimeoutMs == null ? "" : String(config.requestTimeoutMs),
		streamTimeoutMs: config?.streamTimeoutMs == null ? "" : String(config.streamTimeoutMs),
		toolTimeoutMs: config?.toolTimeoutMs == null ? "" : String(config.toolTimeoutMs),
		agentTimeoutMs: config?.agentTimeoutMs == null ? "" : String(config.agentTimeoutMs),
		conversationTimeoutMs: config?.conversationTimeoutMs == null ? "" : String(config.conversationTimeoutMs),
		maxAgentWritableFileLines: String(config?.maxAgentWritableFileLines ?? 1000),
		maxConcurrentTasks: String(config?.maxConcurrentTasks ?? 3),
		workspaceBaseDir: config?.workspaceBaseDir ?? "",
		deviceRamGb: config?.deviceRamGb ?? "",
		sandboxMaxContainers: String(config?.sandboxMaxContainers ?? 1),
		sandboxAgentsPerContainer: String(config?.sandboxAgentsPerContainer ?? 0),
		sandboxMemoryPerContainerMb: String(config?.sandboxMemoryPerContainerMb ?? 2048),
		sandboxCpusPerContainer: String(config?.sandboxCpusPerContainer ?? 2),
		sandboxIdleTimeoutMinutes: String(config?.sandboxIdleTimeoutMinutes ?? 10),
		sandboxIsolationProfileDefault: config?.sandboxIsolationProfileDefault ?? "lean_shared",
		lostHeartbeatPolicy: config?.lostHeartbeatPolicy ?? "park",
		decompositionAutoApplyEnabled: config?.decompositionAutoApplyEnabled ?? true,
		testDrivenModeEnabled: config?.testDrivenModeEnabled ?? false,
		hardTaskRoutingMode: config?.hardTaskRoutingMode ?? "attempt_with_available",
		secondOpinionReviewEnabled: config?.secondOpinionReviewEnabled ?? true,
		reviewMaxRounds: config?.reviewMaxRounds ?? 20,
		speculativeBestOfNEnabled: config?.speculativeBestOfNEnabled ?? true,
		speculativeMaxConcurrentSpecs: config?.speculativeMaxConcurrentSpecs ?? 1,
		speculativeMaxSpecsPerRun: config?.speculativeMaxSpecsPerRun ?? 3,
		swarmGuardrails: config?.swarmGuardrails ?? DEFAULT_RUNTIME_SWARM_GUARDRAILS,
		developerModeEnabled: config?.developerModeEnabled ?? false,
		replayCardsEnabled: config?.replayCardsEnabled ?? false,
		knowsTodayEnabled: config?.knowsTodayEnabled ?? false,
		retrievalEgressEnabled: config?.retrievalEgressEnabled ?? false,
		retrievalSearchBackendUrl: config?.retrievalSearchBackendUrl ?? "",
		llmfitCatalogUpdateMode: config?.llmfitCatalogUpdateMode ?? "notify",
		sandboxMcpServersEnabled: config?.sandboxMcpServersEnabled ?? true,
		capabilityBrokerEnabled: config?.capabilityBrokerEnabled ?? false,
		basicMemoryEnabled: config?.basicMemoryEnabled ?? false,
		chatAdaptiveTruncationEnabled: config?.chatAdaptiveTruncationEnabled ?? true,
		reasoningBudgetEnabled: config?.reasoningBudgetEnabled ?? false,
		reviewLensesEnabled: config?.reviewLensesEnabled ?? false,
		readyForReviewNotificationsEnabled: config?.readyForReviewNotificationsEnabled ?? true,
		codeEmbeddingDefaults: config?.codeEmbeddingDefaults ?? DEFAULT_CODE_EMBEDDING_DEFAULTS,
		codeEmbeddingOverride: config?.codeEmbeddingOverride ?? null,
		shortcuts: config?.shortcuts ?? [],
		maxConcurrentTasksOverride: config?.maxConcurrentTasksOverride ?? null,
		selectedAgentIdOverride: config?.selectedAgentIdOverride ?? null,
		modelRoles: normalizeModelRolesForSettings(config?.modelRoles),
		concurrencyDefaults: cloneConcurrencyMaps(config?.concurrencyDefaults),
		modelGateUnsuitable: config?.modelSuitabilityPolicyDefaults?.onUnsuitable ?? "reject",
		modelGateUnknown: config?.modelSuitabilityPolicyDefaults?.onUnknown ?? "warn",
		skillDynamicsLevel: config?.skillDynamicsLevelDefault ?? "fully_dynamic",
		skillDynamicsLevelOverride: config?.skillDynamicsLevelOverride ?? null,
		concurrencyOverride:
			config?.concurrencyOverride != null ? cloneConcurrencyMaps(config.concurrencyOverride) : null,
		agentRulesets: config?.agentRulesets ?? DEFAULT_AGENT_RULESETS_CONFIG,
		modelRolesOverride:
			config?.modelRolesOverride != null ? normalizeModelRolesForSettings(config.modelRolesOverride) : null,
		agentRulesetsOverride: config?.agentRulesetsOverride ?? null,
		commitPromptTemplate: config?.commitPromptTemplate ?? "",
		openPrPromptTemplate: config?.openPrPromptTemplate ?? "",
	};
}

/** The swarm-guardrail form inputs a snapshot resets the draft to. */
export function snapshotSwarmGuardrailInputs(snapshot: SettingsConfigSnapshot): SwarmGuardrailInputs {
	return swarmGuardrailsToInputs(snapshot.swarmGuardrails);
}

/** localStorage-backed task-default seed: only literal "true"/"false" override the fallback. */
export function readBooleanTaskDefault(key: LocalStorageKey, fallback: boolean): boolean {
	const stored = readLocalStorageItem(key);
	if (stored === "true") {
		return true;
	}
	if (stored === "false") {
		return false;
	}
	return fallback;
}

/** localStorage-backed auto-review-mode seed: anything but "pr" falls back to "commit". */
export function readTaskAutoReviewModeDefault(): RuntimeTaskAutoReviewMode {
	const stored = readLocalStorageItem(LocalStorageKey.TaskAutoReviewMode);
	return stored === "pr" ? "pr" : "commit";
}

/** Dialog-local draft state that is persisted outside the runtime config (localStorage-backed). */
export interface SettingsLocalDraft {
	taskDefaultStartInPlanMode: boolean;
	taskDefaultAutoReviewEnabled: boolean;
	taskDefaultAutoReviewMode: RuntimeTaskAutoReviewMode;
	themeId: ThemeId;
}

export interface SettingsDirtyArgs {
	draft: SettingsDraft;
	snapshot: SettingsConfigSnapshot;
	local: SettingsLocalDraft;
	localInitial: SettingsLocalDraft;
	/** Dirty flag owned by the !Klein provider settings controller. */
	nkleinSettingsDirty: boolean;
	/** Dirty flag owned by the !Klein MCP settings controller. */
	nkleinMcpSettingsDirty: boolean;
}

/**
 * Whether the draft differs from the loaded config snapshot (plus the localStorage-backed task
 * defaults/theme and the external !Klein controller flags). Field-group semantics match the dialog's
 * historical checks exactly: numeric strings compare trimmed, prompt templates compare normalized,
 * concurrency maps compare by JSON, model roles by their serialized form.
 */
export function isSettingsDraftDirty(args: SettingsDirtyArgs): boolean {
	const { draft, snapshot, local, localInitial, nkleinSettingsDirty, nkleinMcpSettingsDirty } = args;
	if (draft.selectedAgentId !== snapshot.selectedAgentId) {
		return true;
	}
	if (draft.agentAutonomousModeEnabled !== snapshot.agentAutonomousModeEnabled) {
		return true;
	}
	if (draft.agentTimeoutMode !== snapshot.agentTimeoutMode) {
		return true;
	}
	if (draft.agentTimeoutProfile !== snapshot.agentTimeoutProfile) {
		return true;
	}
	if (draft.requestTimeoutMs.trim() !== snapshot.requestTimeoutMs.trim()) {
		return true;
	}
	if (draft.streamTimeoutMs.trim() !== snapshot.streamTimeoutMs.trim()) {
		return true;
	}
	if (draft.toolTimeoutMs.trim() !== snapshot.toolTimeoutMs.trim()) {
		return true;
	}
	if (draft.agentTimeoutMs.trim() !== snapshot.agentTimeoutMs.trim()) {
		return true;
	}
	if (draft.conversationTimeoutMs.trim() !== snapshot.conversationTimeoutMs.trim()) {
		return true;
	}
	if (draft.maxAgentWritableFileLines.trim() !== snapshot.maxAgentWritableFileLines.trim()) {
		return true;
	}
	if (draft.maxConcurrentTasks.trim() !== snapshot.maxConcurrentTasks.trim()) {
		return true;
	}
	if (draft.workspaceBaseDir.trim() !== snapshot.workspaceBaseDir.trim()) {
		return true;
	}
	if (draft.deviceRamGb.trim() !== snapshot.deviceRamGb.trim()) {
		return true;
	}
	if (draft.sandboxMaxContainers.trim() !== snapshot.sandboxMaxContainers.trim()) {
		return true;
	}
	if (draft.sandboxAgentsPerContainer.trim() !== snapshot.sandboxAgentsPerContainer.trim()) {
		return true;
	}
	if (draft.sandboxMemoryPerContainerMb.trim() !== snapshot.sandboxMemoryPerContainerMb.trim()) {
		return true;
	}
	if (draft.sandboxCpusPerContainer.trim() !== snapshot.sandboxCpusPerContainer.trim()) {
		return true;
	}
	if (draft.sandboxIdleTimeoutMinutes.trim() !== snapshot.sandboxIdleTimeoutMinutes.trim()) {
		return true;
	}
	if (draft.sandboxIsolationProfileDefault !== snapshot.sandboxIsolationProfileDefault) {
		return true;
	}
	if (draft.lostHeartbeatPolicy !== snapshot.lostHeartbeatPolicy) {
		return true;
	}
	if (draft.decompositionAutoApplyEnabled !== snapshot.decompositionAutoApplyEnabled) {
		return true;
	}
	if (draft.hardTaskRoutingMode !== snapshot.hardTaskRoutingMode) {
		return true;
	}
	if (draft.testDrivenModeEnabled !== snapshot.testDrivenModeEnabled) {
		return true;
	}
	if (draft.secondOpinionReviewEnabled !== snapshot.secondOpinionReviewEnabled) {
		return true;
	}
	if (draft.reviewMaxRounds !== snapshot.reviewMaxRounds) {
		return true;
	}
	if (draft.speculativeBestOfNEnabled !== snapshot.speculativeBestOfNEnabled) {
		return true;
	}
	if (draft.speculativeMaxConcurrentSpecs !== snapshot.speculativeMaxConcurrentSpecs) {
		return true;
	}
	if (draft.speculativeMaxSpecsPerRun !== snapshot.speculativeMaxSpecsPerRun) {
		return true;
	}
	if (!areRuntimeSwarmGuardrailsEqual(inputsToSwarmGuardrails(draft.swarmGuardrailInputs), snapshot.swarmGuardrails)) {
		return true;
	}
	if (draft.developerModeEnabled !== snapshot.developerModeEnabled) {
		return true;
	}
	if (draft.replayCardsEnabled !== snapshot.replayCardsEnabled) {
		return true;
	}
	if (draft.knowsTodayEnabled !== snapshot.knowsTodayEnabled) {
		return true;
	}
	if (draft.retrievalEgressEnabled !== snapshot.retrievalEgressEnabled) {
		return true;
	}
	if (draft.retrievalSearchBackendUrl.trim() !== snapshot.retrievalSearchBackendUrl.trim()) {
		return true;
	}
	if (draft.llmfitCatalogUpdateMode !== snapshot.llmfitCatalogUpdateMode) {
		return true;
	}
	if (draft.sandboxMcpServersEnabled !== snapshot.sandboxMcpServersEnabled) {
		return true;
	}
	if (draft.capabilityBrokerEnabled !== snapshot.capabilityBrokerEnabled) {
		return true;
	}
	if (draft.basicMemoryEnabled !== snapshot.basicMemoryEnabled) {
		return true;
	}
	if (draft.chatAdaptiveTruncationEnabled !== snapshot.chatAdaptiveTruncationEnabled) {
		return true;
	}
	if (draft.reasoningBudgetEnabled !== snapshot.reasoningBudgetEnabled) {
		return true;
	}
	if (draft.reviewLensesEnabled !== snapshot.reviewLensesEnabled) {
		return true;
	}
	if (draft.readyForReviewNotificationsEnabled !== snapshot.readyForReviewNotificationsEnabled) {
		return true;
	}
	if (!areCodeEmbeddingSettingsEqual(draft.codeEmbeddingDefaults, snapshot.codeEmbeddingDefaults)) {
		return true;
	}
	if (!areCodeEmbeddingSettingsEqual(draft.codeEmbeddingOverride, snapshot.codeEmbeddingOverride)) {
		return true;
	}
	if (
		local.taskDefaultStartInPlanMode !== localInitial.taskDefaultStartInPlanMode ||
		local.taskDefaultAutoReviewEnabled !== localInitial.taskDefaultAutoReviewEnabled ||
		local.taskDefaultAutoReviewMode !== localInitial.taskDefaultAutoReviewMode
	) {
		return true;
	}
	if (nkleinSettingsDirty) {
		return true;
	}
	if (nkleinMcpSettingsDirty) {
		return true;
	}
	if (serializeModelRoles(draft.modelRoles) !== serializeModelRoles(snapshot.modelRoles)) {
		return true;
	}
	if (JSON.stringify(draft.concurrencyDefaults) !== JSON.stringify(snapshot.concurrencyDefaults)) {
		return true;
	}
	if (
		draft.modelGateUnsuitable !== snapshot.modelGateUnsuitable ||
		draft.modelGateUnknown !== snapshot.modelGateUnknown
	) {
		return true;
	}
	if (draft.skillDynamicsLevel !== snapshot.skillDynamicsLevel) {
		return true;
	}
	if (JSON.stringify(draft.concurrencyOverride) !== JSON.stringify(snapshot.concurrencyOverride)) {
		return true;
	}
	if (JSON.stringify(draft.agentRulesets) !== JSON.stringify(snapshot.agentRulesets)) {
		return true;
	}
	if (local.themeId !== localInitial.themeId) {
		return true;
	}
	if (!areRuntimeProjectShortcutsEqual(draft.shortcuts, snapshot.shortcuts)) {
		return true;
	}
	if (draft.maxConcurrentTasksOverride !== snapshot.maxConcurrentTasksOverride) {
		return true;
	}
	if (draft.skillDynamicsLevelOverride !== snapshot.skillDynamicsLevelOverride) {
		return true;
	}
	if (draft.selectedAgentIdOverride !== snapshot.selectedAgentIdOverride) {
		return true;
	}
	if (
		(draft.modelRolesOverride === null) !== (snapshot.modelRolesOverride === null) ||
		(draft.modelRolesOverride !== null &&
			serializeModelRoles(draft.modelRolesOverride) !== serializeModelRoles(snapshot.modelRolesOverride ?? {}))
	) {
		return true;
	}
	if (JSON.stringify(draft.agentRulesetsOverride) !== JSON.stringify(snapshot.agentRulesetsOverride)) {
		return true;
	}
	if (
		normalizeTemplateForComparison(draft.commitPromptTemplate) !==
		normalizeTemplateForComparison(snapshot.commitPromptTemplate)
	) {
		return true;
	}
	return (
		normalizeTemplateForComparison(draft.openPrPromptTemplate) !==
		normalizeTemplateForComparison(snapshot.openPrPromptTemplate)
	);
}
