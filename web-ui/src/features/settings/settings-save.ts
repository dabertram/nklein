// Settings save behavior (todo §5.AK) — pure validation + updateRuntimeConfig payload construction
// for the runtime settings dialog. Extracted verbatim from the dialog's save handler; error messages,
// check order, and payload shape are behavior-contract and must not drift.
import {
	MODEL_ROLE_IDS,
	MODEL_ROLE_LABELS,
	type ModelRoleId,
	normalizeModelRolesForSettings,
} from "@/components/runtime-settings-model-roles";
import { findProviderCatalogItem } from "@/components/runtime-settings-provider-helpers";
import { inputsToSwarmGuardrails } from "@/components/runtime-settings-swarm-guardrails";
import type { SettingsDraft } from "@/features/settings/settings-draft";
import {
	findNKleinProviderModel,
	getNKleinModelContextWindowWarning,
	isLmStudioProviderId,
} from "@/runtime/nklein-context-window-policy";
import type {
	RuntimeCodeEmbeddingSettings,
	RuntimeConfigSaveRequest,
	RuntimeModelRoles,
	RuntimeNKleinProviderCatalogItem,
	RuntimeNKleinProviderModel,
} from "@/runtime/types";

/** Blank input means "unset" (null); otherwise the value must be a non-negative integer. */
export function parseTimeoutMsInput(value: string): number | null | "invalid" {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return null;
	}
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
		return "invalid";
	}
	return parsed;
}

/** Strictly positive number (fractions allowed, e.g. sandbox CPUs); blank input is invalid. */
export function parsePositiveNumberInput(value: string): number | "invalid" {
	const parsed = Number(value.trim());
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return "invalid";
	}
	return parsed;
}

export interface ParsedSettingsNumbers {
	requestTimeoutMs: number | null;
	streamTimeoutMs: number | null;
	toolTimeoutMs: number | null;
	agentTimeoutMs: number | null;
	conversationTimeoutMs: number | null;
	maxAgentWritableFileLines: number;
	maxConcurrentTasks: number;
	sandboxMaxContainers: number;
	sandboxAgentsPerContainer: number;
	sandboxMemoryPerContainerMb: number;
	sandboxCpusPerContainer: number;
	sandboxIdleTimeoutMinutes: number;
}

export type SettingsNumbersResult = { ok: true; parsed: ParsedSettingsNumbers } | { ok: false; error: string };

type NumericDraftFields = Pick<
	SettingsDraft,
	| "requestTimeoutMs"
	| "streamTimeoutMs"
	| "toolTimeoutMs"
	| "agentTimeoutMs"
	| "conversationTimeoutMs"
	| "maxAgentWritableFileLines"
	| "maxConcurrentTasks"
	| "sandboxMaxContainers"
	| "sandboxAgentsPerContainer"
	| "sandboxMemoryPerContainerMb"
	| "sandboxCpusPerContainer"
	| "sandboxIdleTimeoutMinutes"
>;

/**
 * Parses and range-validates every numeric text input of the draft. Returns either the parsed numbers
 * or the first save error, in the dialog's historical check order (aggregate parse failure first, then
 * per-field range messages).
 */
export function validateAndParseSettingsNumbers(draft: NumericDraftFields): SettingsNumbersResult {
	const parsedRequestTimeout = parseTimeoutMsInput(draft.requestTimeoutMs);
	const parsedStreamTimeout = parseTimeoutMsInput(draft.streamTimeoutMs);
	const parsedToolTimeout = parseTimeoutMsInput(draft.toolTimeoutMs);
	const parsedAgentTimeout = parseTimeoutMsInput(draft.agentTimeoutMs);
	const parsedConversationTimeout = parseTimeoutMsInput(draft.conversationTimeoutMs);
	const parsedMaxAgentWritableFileLines = parseTimeoutMsInput(draft.maxAgentWritableFileLines);
	const parsedMaxConcurrentTasks = parseTimeoutMsInput(draft.maxConcurrentTasks);
	const parsedSandboxMaxContainers = parseTimeoutMsInput(draft.sandboxMaxContainers);
	const parsedSandboxAgentsPerContainer = parseTimeoutMsInput(draft.sandboxAgentsPerContainer);
	const parsedSandboxMemoryPerContainerMb = parseTimeoutMsInput(draft.sandboxMemoryPerContainerMb);
	const parsedSandboxCpusPerContainer = parsePositiveNumberInput(draft.sandboxCpusPerContainer);
	const parsedSandboxIdleTimeoutMinutes = parseTimeoutMsInput(draft.sandboxIdleTimeoutMinutes);
	if (
		parsedRequestTimeout === "invalid" ||
		parsedStreamTimeout === "invalid" ||
		parsedToolTimeout === "invalid" ||
		parsedAgentTimeout === "invalid" ||
		parsedConversationTimeout === "invalid" ||
		parsedMaxAgentWritableFileLines === "invalid" ||
		parsedMaxAgentWritableFileLines === null ||
		parsedMaxConcurrentTasks === "invalid" ||
		parsedMaxConcurrentTasks === null ||
		parsedSandboxMaxContainers === "invalid" ||
		parsedSandboxMaxContainers === null ||
		parsedSandboxAgentsPerContainer === "invalid" ||
		parsedSandboxAgentsPerContainer === null ||
		parsedSandboxMemoryPerContainerMb === "invalid" ||
		parsedSandboxMemoryPerContainerMb === null ||
		parsedSandboxCpusPerContainer === "invalid" ||
		parsedSandboxIdleTimeoutMinutes === "invalid" ||
		parsedSandboxIdleTimeoutMinutes === null
	) {
		return {
			ok: false,
			error: "Timeout values must be integers >= 0; the file-size soft target, concurrency, and sandbox pool settings must be within their allowed ranges.",
		};
	}
	if (parsedMaxAgentWritableFileLines < 1) {
		return { ok: false, error: "The file-size soft target must be an integer >= 1." };
	}
	if (parsedMaxConcurrentTasks < 1) {
		return { ok: false, error: "Max concurrent tasks must be an integer >= 1." };
	}
	if (parsedSandboxMaxContainers < 1) {
		return { ok: false, error: "Sandbox max containers must be an integer >= 1." };
	}
	if (parsedSandboxAgentsPerContainer < 0) {
		return { ok: false, error: "Sandbox agents per container must be an integer >= 0." };
	}
	if (parsedSandboxMemoryPerContainerMb < 1) {
		return { ok: false, error: "Sandbox memory per container must be an integer >= 1." };
	}
	if (parsedSandboxIdleTimeoutMinutes < 1) {
		return { ok: false, error: "Sandbox idle timeout must be an integer >= 1 minute." };
	}
	return {
		ok: true,
		parsed: {
			requestTimeoutMs: parsedRequestTimeout,
			streamTimeoutMs: parsedStreamTimeout,
			toolTimeoutMs: parsedToolTimeout,
			agentTimeoutMs: parsedAgentTimeout,
			conversationTimeoutMs: parsedConversationTimeout,
			maxAgentWritableFileLines: parsedMaxAgentWritableFileLines,
			maxConcurrentTasks: parsedMaxConcurrentTasks,
			sandboxMaxContainers: parsedSandboxMaxContainers,
			sandboxAgentsPerContainer: parsedSandboxAgentsPerContainer,
			sandboxMemoryPerContainerMb: parsedSandboxMemoryPerContainerMb,
			sandboxCpusPerContainer: parsedSandboxCpusPerContainer,
			sandboxIdleTimeoutMinutes: parsedSandboxIdleTimeoutMinutes,
		},
	};
}

/** Required combo: OpenAI-compatible embedding defaults need both an endpoint URL and a model id. */
export function validateCodeEmbeddingDefaultsForSave(settings: RuntimeCodeEmbeddingSettings): string | null {
	if (settings.provider === "openai_compatible" && (!settings.baseUrl || !settings.model)) {
		return "Default OpenAI-compatible embeddings need both an endpoint URL and a model id.";
	}
	return null;
}

export interface ModelRoleWarningContext {
	modelRoles: RuntimeModelRoles;
	/** The trimmed provider id of the main !Klein provider selection (fallback for roles on "auto"). */
	nkleinProviderId: string;
	providerCatalog: RuntimeNKleinProviderCatalogItem[];
	getModelsForProvider: (providerId: string) => RuntimeNKleinProviderModel[];
}

/** Context-window feasibility warning for one model role, or null when the role passes. */
export function getModelRoleContextWarningForSave(
	roleId: ModelRoleId,
	context: ModelRoleWarningContext,
): string | null {
	const roleSettings = context.modelRoles[roleId] ?? {};
	const roleProviderId = roleSettings.providerId ?? "";
	const effectiveProviderId = roleProviderId || context.nkleinProviderId;
	const providerDefaultModelId = roleProviderId
		? (findProviderCatalogItem(context.providerCatalog, roleProviderId)?.defaultModelId?.trim() ?? "")
		: "";
	const effectiveModelId = roleSettings.modelId?.trim() || providerDefaultModelId;
	if (!effectiveModelId) {
		return null;
	}
	const roleModels = context.getModelsForProvider(effectiveProviderId);
	return getNKleinModelContextWindowWarning({
		model: findNKleinProviderModel(roleModels, effectiveModelId),
		modelId: effectiveModelId,
		label: `${MODEL_ROLE_LABELS[roleId]} model`,
	});
}

/** LM Studio loaded-model requirement for one model role, or null when the role passes. */
export function getModelRoleAvailabilityWarningForSave(
	roleId: ModelRoleId,
	context: ModelRoleWarningContext,
): string | null {
	const roleSettings = context.modelRoles[roleId] ?? {};
	const roleProviderId = roleSettings.providerId ?? "";
	const effectiveProviderId = roleProviderId || context.nkleinProviderId;
	if (!isLmStudioProviderId(effectiveProviderId)) {
		return null;
	}
	const roleModelId = roleSettings.modelId?.trim() ?? "";
	if (roleProviderId && !roleModelId) {
		return `${MODEL_ROLE_LABELS[roleId]} role uses LM Studio. Choose a loaded LM Studio model before saving.`;
	}
	if (!roleModelId) {
		return null;
	}
	const roleModels = context.getModelsForProvider(effectiveProviderId);
	if (findNKleinProviderModel(roleModels, roleModelId)) {
		return null;
	}
	return `${MODEL_ROLE_LABELS[roleId]} model "${roleModelId}" is not loaded in LM Studio. Load it, refresh models, then choose it before saving.`;
}

/** First availability warning across all model roles (dialog blocks saving on it), or null. */
export function findFirstModelRoleAvailabilityWarning(context: ModelRoleWarningContext): string | null {
	return (
		MODEL_ROLE_IDS.map((roleId) => getModelRoleAvailabilityWarningForSave(roleId, context)).find(
			(warning): warning is string => warning !== null,
		) ?? null
	);
}

/** First context-window warning across all model roles (dialog blocks saving on it), or null. */
export function findFirstModelRoleContextWarning(context: ModelRoleWarningContext): string | null {
	return (
		MODEL_ROLE_IDS.map((roleId) => getModelRoleContextWarningForSave(roleId, context)).find(
			(warning): warning is string => warning !== null,
		) ?? null
	);
}

/**
 * Builds the updateRuntimeConfig payload from the validated draft. Sparse/partial semantics live here:
 * blank workspace/retrieval URLs save as null (trimmed otherwise), timeouts save as null when unset,
 * model roles are normalized, and request-only fields (e.g. setup wizard stamps) are simply omitted.
 */
export function buildRuntimeConfigSaveRequest(
	draft: SettingsDraft,
	parsed: ParsedSettingsNumbers,
): RuntimeConfigSaveRequest {
	return {
		selectedAgentId: draft.selectedAgentId,
		selectedAgentIdOverride: draft.selectedAgentIdOverride,
		maxConcurrentTasksOverride: draft.maxConcurrentTasksOverride,
		modelRolesOverride:
			draft.modelRolesOverride !== null ? normalizeModelRolesForSettings(draft.modelRolesOverride) : null,
		agentRulesetsOverride: draft.agentRulesetsOverride,
		agentAutonomousModeEnabled: draft.agentAutonomousModeEnabled,
		agentTimeoutMode: draft.agentTimeoutMode,
		agentTimeoutProfile: draft.agentTimeoutProfile,
		requestTimeoutMs: parsed.requestTimeoutMs,
		streamTimeoutMs: parsed.streamTimeoutMs,
		toolTimeoutMs: parsed.toolTimeoutMs,
		agentTimeoutMs: parsed.agentTimeoutMs,
		conversationTimeoutMs: parsed.conversationTimeoutMs,
		maxAgentWritableFileLines: parsed.maxAgentWritableFileLines,
		maxConcurrentTasks: parsed.maxConcurrentTasks,
		workspaceBaseDir: draft.workspaceBaseDir.trim() || null,
		deviceRamGb: draft.deviceRamGb.trim() || null,
		sandboxEgressProxyEnabled: draft.sandboxEgressProxyEnabled,
		sandboxEgressAllowlist: draft.sandboxEgressAllowlist.trim() || null,
		sandboxMaxContainers: parsed.sandboxMaxContainers,
		sandboxAgentsPerContainer: parsed.sandboxAgentsPerContainer,
		sandboxMemoryPerContainerMb: parsed.sandboxMemoryPerContainerMb,
		sandboxCpusPerContainer: parsed.sandboxCpusPerContainer,
		sandboxIdleTimeoutMinutes: parsed.sandboxIdleTimeoutMinutes,
		sandboxIsolationProfileDefault: draft.sandboxIsolationProfileDefault,
		lostHeartbeatPolicy: draft.lostHeartbeatPolicy,
		decompositionAutoApplyEnabled: draft.decompositionAutoApplyEnabled,
		testDrivenModeEnabled: draft.testDrivenModeEnabled,
		hardTaskRoutingMode: draft.hardTaskRoutingMode,
		secondOpinionReviewEnabled: draft.secondOpinionReviewEnabled,
		reviewMaxRounds: draft.reviewMaxRounds,
		speculativeBestOfNEnabled: draft.speculativeBestOfNEnabled,
		speculativeMaxConcurrentSpecs: draft.speculativeMaxConcurrentSpecs,
		speculativeMaxSpecsPerRun: draft.speculativeMaxSpecsPerRun,
		swarmGuardrails: inputsToSwarmGuardrails(draft.swarmGuardrailInputs),
		developerModeEnabled: draft.developerModeEnabled,
		replayCardsEnabled: draft.replayCardsEnabled,
		knowsTodayEnabled: draft.knowsTodayEnabled,
		retrievalEgressEnabled: draft.retrievalEgressEnabled,
		retrievalSearchBackendUrl: draft.retrievalSearchBackendUrl.trim() || null,
		llmfitCatalogUpdateMode: draft.llmfitCatalogUpdateMode,
		sandboxMcpServersEnabled: draft.sandboxMcpServersEnabled,
		capabilityBrokerEnabled: draft.capabilityBrokerEnabled,
		basicMemoryEnabled: draft.basicMemoryEnabled,
		chatAdaptiveTruncationEnabled: draft.chatAdaptiveTruncationEnabled,
		reasoningBudgetEnabled: draft.reasoningBudgetEnabled,
		reviewLensesEnabled: draft.reviewLensesEnabled,
		codeEmbeddingDefaults: draft.codeEmbeddingDefaults,
		codeEmbeddingOverride: draft.codeEmbeddingOverride,
		readyForReviewNotificationsEnabled: draft.readyForReviewNotificationsEnabled,
		modelRoles: normalizeModelRolesForSettings(draft.modelRoles),
		modelSuitabilityPolicyDefaults: { onUnsuitable: draft.modelGateUnsuitable, onUnknown: draft.modelGateUnknown },
		skillDynamicsLevelDefault: draft.skillDynamicsLevel,
		skillDynamicsLevelOverride: draft.skillDynamicsLevelOverride,
		concurrencyDefaults: draft.concurrencyDefaults,
		concurrencyOverride: draft.concurrencyOverride,
		agentRulesets: draft.agentRulesets,
		shortcuts: draft.shortcuts,
		commitPromptTemplate: draft.commitPromptTemplate,
		openPrPromptTemplate: draft.openPrPromptTemplate,
	};
}
