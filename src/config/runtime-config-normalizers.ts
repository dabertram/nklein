/**
 * Pure runtime-config value normalizers (§5.U-extracted from the oversized `runtime-config.ts`). Each takes a raw /
 * persisted / unknown value and returns a validated, defaulted runtime value (or its override/equality counterpart).
 * They depend only on the seed values in `./runtime-config-defaults` plus shared schemas/policies — never on the
 * config loading logic — so they live apart from `loadRuntimeConfig`.
 */

import { isRuntimeAgentLaunchSupported } from "../core/agent-catalog";
import { DEFAULT_AGENT_RULESETS_CONFIG } from "../core/agent-rulesets";
import type {
	AgentRulesetsConfigPayload,
	RuntimeAgentId,
	RuntimeAgentTimeoutMode,
	RuntimeAgentTimeoutProfile,
	RuntimeCodeEmbeddingSettings,
	RuntimeLostHeartbeatPolicy,
	RuntimeModelRoles,
	RuntimeModelSuitabilityPolicy,
	RuntimeProjectShortcut,
	RuntimeSkillDynamicsLevel,
	RuntimeTaskNKleinSettings,
} from "../core/api-contract";
import {
	agentRulesetsConfigSchema,
	DEFAULT_RUNTIME_MODEL_SUITABILITY_POLICY,
	DEFAULT_RUNTIME_SKILL_DYNAMICS_LEVEL,
	runtimeCodeEmbeddingSettingsSchema,
	runtimeModelSuitabilityPolicySchema,
	runtimeRoleModelSettingsSchema,
	runtimeSkillDynamicsLevelSchema,
} from "../core/api-contract";
import { CLOUD_ENABLED } from "../nklein-agent/nklein-local-only-policy";
import { isDebugOverrideEnvEnabled } from "./debug-override";
import {
	DEFAULT_AGENT_ID,
	DEFAULT_AGENT_TIMEOUT_MODE,
	DEFAULT_AGENT_TIMEOUT_PROFILE,
	DEFAULT_CODE_EMBEDDING_SETTINGS,
	DEFAULT_DEVELOPER_MODE_ENABLED,
	DEFAULT_LOCAL_AGENT_TIMEOUT_MS,
	DEFAULT_LOCAL_CONVERSATION_TIMEOUT_MS,
	DEFAULT_LOCAL_REQUEST_TIMEOUT_MS,
	DEFAULT_LOCAL_STREAM_TIMEOUT_MS,
	DEFAULT_LOCAL_TOOL_TIMEOUT_MS,
	DEFAULT_LOST_HEARTBEAT_POLICY,
	DEFAULT_MAX_CONCURRENT_TASKS,
} from "./runtime-config-defaults";
import type { RuntimeGlobalConfigFileShape } from "./runtime-config-types";

export function normalizeAgentId(agentId: RuntimeAgentId | string | null | undefined): RuntimeAgentId {
	if (
		(agentId === "claude" ||
			agentId === "codex" ||
			agentId === "gemini" ||
			agentId === "opencode" ||
			agentId === "droid" ||
			agentId === "kiro" ||
			agentId === "nklein") &&
		isRuntimeAgentLaunchSupported(agentId)
	) {
		if (!CLOUD_ENABLED && agentId !== "nklein") {
			return DEFAULT_AGENT_ID;
		}
		return agentId;
	}
	return DEFAULT_AGENT_ID;
}

export function normalizeDeveloperModeEnabled(globalConfig: RuntimeGlobalConfigFileShape | null): boolean {
	if (globalConfig != null && Object.hasOwn(globalConfig, "developerModeEnabled")) {
		return normalizeBoolean(globalConfig?.developerModeEnabled, DEFAULT_DEVELOPER_MODE_ENABLED);
	}
	const legacyValue = readLegacyDeveloperModeEnabled(globalConfig);
	if (legacyValue !== null) {
		return legacyValue;
	}
	return isDebugOverrideEnvEnabled();
}

export function readLegacyDeveloperModeEnabled(globalConfig: RuntimeGlobalConfigFileShape | null): boolean | null {
	const legacyKey = `debug${"Mode"}Enabled`;
	if (!globalConfig || !Object.hasOwn(globalConfig, legacyKey)) {
		return null;
	}
	return normalizeBoolean(
		(globalConfig as Record<string, unknown> | null)?.[legacyKey],
		DEFAULT_DEVELOPER_MODE_ENABLED,
	);
}

export function normalizeAgentTimeoutMode(value: unknown): RuntimeAgentTimeoutMode {
	if (value === "normal" || value === "long" || value === "extended" || value === "unlimited") {
		return value;
	}
	if (value === "very_long") {
		return "extended";
	}
	return DEFAULT_AGENT_TIMEOUT_MODE;
}

export function normalizeAgentTimeoutProfile(value: unknown): RuntimeAgentTimeoutProfile {
	if (value === "cloud" || value === "local" || value === "custom") {
		return value;
	}
	return DEFAULT_AGENT_TIMEOUT_PROFILE;
}

export function normalizeTimeoutMsValue(value: unknown): number | null {
	if (value === null) {
		return null;
	}
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
		return Math.trunc(value);
	}
	return null;
}

export function resolveProfileTimeoutDefaults(profile: RuntimeAgentTimeoutProfile): {
	requestTimeoutMs: number | null;
	streamTimeoutMs: number | null;
	toolTimeoutMs: number | null;
	agentTimeoutMs: number | null;
	conversationTimeoutMs: number | null;
} {
	if (profile === "cloud" || profile === "local") {
		return {
			requestTimeoutMs: DEFAULT_LOCAL_REQUEST_TIMEOUT_MS,
			streamTimeoutMs: DEFAULT_LOCAL_STREAM_TIMEOUT_MS,
			toolTimeoutMs: DEFAULT_LOCAL_TOOL_TIMEOUT_MS,
			agentTimeoutMs: DEFAULT_LOCAL_AGENT_TIMEOUT_MS,
			conversationTimeoutMs: DEFAULT_LOCAL_CONVERSATION_TIMEOUT_MS,
		};
	}
	return {
		requestTimeoutMs: null,
		streamTimeoutMs: null,
		toolTimeoutMs: null,
		agentTimeoutMs: null,
		conversationTimeoutMs: null,
	};
}
function normalizeShortcut(shortcut: RuntimeProjectShortcut): RuntimeProjectShortcut | null {
	if (!shortcut || typeof shortcut !== "object") {
		return null;
	}

	const label = typeof shortcut.label === "string" ? shortcut.label.trim() : "";
	const command = typeof shortcut.command === "string" ? shortcut.command.trim() : "";
	const icon = typeof shortcut.icon === "string" ? shortcut.icon.trim() : "";

	if (!label || !command) {
		return null;
	}

	return {
		label,
		command,
		icon: icon || undefined,
	};
}

export function normalizeShortcuts(shortcuts: RuntimeProjectShortcut[] | null | undefined): RuntimeProjectShortcut[] {
	if (!Array.isArray(shortcuts)) {
		return [];
	}
	const normalized: RuntimeProjectShortcut[] = [];
	for (const shortcut of shortcuts) {
		const parsed = normalizeShortcut(shortcut);
		if (parsed) {
			normalized.push(parsed);
		}
	}
	return normalized;
}

export function normalizeModelRoles(value: unknown): RuntimeModelRoles {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	const normalized: RuntimeModelRoles = {};
	for (const [rawRole, rawSettings] of Object.entries(value as Record<string, unknown>)) {
		const role = rawRole.trim();
		if (!role) {
			continue;
		}
		const parsedSettings = runtimeRoleModelSettingsSchema.safeParse(rawSettings);
		if (!parsedSettings.success) {
			continue;
		}
		const settings = parsedSettings.data;
		const additionalModels = (settings.additionalModels ?? [])
			.map((entry) => pickNKleinSettingsFields(entry))
			.filter((entry) => entry.providerId || entry.modelId);
		normalized[role] = {
			...pickNKleinSettingsFields(settings),
			...(settings.modelClassCap ? { modelClassCap: settings.modelClassCap } : {}),
			...(additionalModels.length > 0 ? { additionalModels } : {}),
		};
	}
	return normalized;
}

// Rebuild a NKlein settings object keeping only the known fields with truthy/defined values, so persisted
// config never carries stray keys. Shared by a role's primary model and each of its pool members.
function pickNKleinSettingsFields(settings: RuntimeTaskNKleinSettings): RuntimeTaskNKleinSettings {
	const providerId = settings.providerId?.trim();
	const modelId = settings.modelId?.trim();
	return {
		...(providerId ? { providerId } : {}),
		...(modelId ? { modelId } : {}),
		...(settings.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
		...(settings.contextScope ? { contextScope: settings.contextScope } : {}),
		...(settings.timeoutMode ? { timeoutMode: settings.timeoutMode } : {}),
		...(settings.requestTimeoutMs !== undefined ? { requestTimeoutMs: settings.requestTimeoutMs } : {}),
		...(settings.streamTimeoutMs !== undefined ? { streamTimeoutMs: settings.streamTimeoutMs } : {}),
		...(settings.toolTimeoutMs !== undefined ? { toolTimeoutMs: settings.toolTimeoutMs } : {}),
		...(settings.agentTimeoutMs !== undefined ? { agentTimeoutMs: settings.agentTimeoutMs } : {}),
		...(settings.conversationTimeoutMs !== undefined
			? { conversationTimeoutMs: settings.conversationTimeoutMs }
			: {}),
	};
}

export function areModelRolesEqual(left: RuntimeModelRoles, right: RuntimeModelRoles): boolean {
	return JSON.stringify(normalizeModelRoles(left)) === JSON.stringify(normalizeModelRoles(right));
}

export function normalizeAgentRulesets(value: unknown): AgentRulesetsConfigPayload {
	const parsed = agentRulesetsConfigSchema.safeParse(value);
	return parsed.success ? parsed.data : DEFAULT_AGENT_RULESETS_CONFIG;
}

export function areAgentRulesetsEqual(
	left: AgentRulesetsConfigPayload | undefined,
	right: AgentRulesetsConfigPayload | undefined,
): boolean {
	return JSON.stringify(normalizeAgentRulesets(left)) === JSON.stringify(normalizeAgentRulesets(right));
}

export function normalizeAgentRulesetsOverride(value: unknown): AgentRulesetsConfigPayload | null {
	if (value === null || value === undefined) {
		return null;
	}
	const normalized = normalizeAgentRulesets(value);
	// Keep the file clean: if the override is identical to the default, treat as no-op.
	return areAgentRulesetsEqual(normalized, DEFAULT_AGENT_RULESETS_CONFIG) ? null : normalized;
}

export function normalizeModelRolesOverride(value: unknown): RuntimeModelRoles | null {
	if (value === null || value === undefined) {
		return null;
	}
	const normalized = normalizeModelRoles(value);
	// Keep the project file clean: an empty roles map is equivalent to no override.
	return Object.keys(normalized).length === 0 ? null : normalized;
}

function normalizePromptTemplate(value: unknown, fallback: string): string {
	if (typeof value !== "string") {
		return fallback;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? value : fallback;
}

export function normalizePromptTemplateWithLegacyDefault(
	value: unknown,
	fallback: string,
	legacyDefault: string,
): string {
	const normalized = normalizePromptTemplate(value, fallback);
	return normalized === legacyDefault ? fallback : normalized;
}

export function normalizeBoolean(value: unknown, fallback: boolean): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	return fallback;
}

export function normalizeMaxConcurrentTasks(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_MAX_CONCURRENT_TASKS;
	}
	const normalized = Math.trunc(value);
	return normalized > 0 ? normalized : DEFAULT_MAX_CONCURRENT_TASKS;
}

export function normalizeMaxConcurrentTasksOverride(value: unknown): number | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	const normalized = Math.trunc(value);
	return normalized > 0 ? normalized : null;
}

export function normalizeSelectedAgentIdOverride(value: unknown): RuntimeAgentId | null {
	if (value === null || value === undefined) {
		return null;
	}
	// Validate it's a known agent id string (without cloud-gating — the effective resolution handles that).
	// We still want to persist "claude" or "codex" in the project file even when CLOUD_ENABLED is false,
	// so a user who toggled cloud back on immediately gets the right agent. Only reject unknown strings.
	if (
		value === "claude" ||
		value === "codex" ||
		value === "gemini" ||
		value === "opencode" ||
		value === "droid" ||
		value === "kiro" ||
		value === "nklein"
	) {
		// Return null when it matches the global default — no point storing a no-op override.
		return value === DEFAULT_AGENT_ID ? null : (value as RuntimeAgentId);
	}
	return null;
}

export function normalizePositiveInteger(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	const normalized = Math.trunc(value);
	return normalized > 0 ? normalized : fallback;
}

export function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	const normalized = Math.trunc(value);
	return normalized >= 0 ? normalized : fallback;
}

export function normalizePositiveNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function normalizeLostHeartbeatPolicy(value: unknown): RuntimeLostHeartbeatPolicy {
	return value === "keep_running" ? "keep_running" : DEFAULT_LOST_HEARTBEAT_POLICY;
}

export function normalizeCodeEmbeddingSettings(
	value: unknown,
	fallback: RuntimeCodeEmbeddingSettings,
): RuntimeCodeEmbeddingSettings {
	const parsed = runtimeCodeEmbeddingSettingsSchema.safeParse(value);
	if (!parsed.success) {
		return fallback;
	}
	const model = parsed.data.model?.trim() || null;
	const baseUrl = parsed.data.baseUrl?.trim() || null;
	if (parsed.data.provider === "local_lexical") {
		return DEFAULT_CODE_EMBEDDING_SETTINGS;
	}
	return {
		provider: "openai_compatible",
		model,
		baseUrl,
	};
}

export function normalizeCodeEmbeddingOverride(value: unknown): RuntimeCodeEmbeddingSettings | null {
	if (value === null || value === undefined) {
		return null;
	}
	return normalizeCodeEmbeddingSettings(value, DEFAULT_CODE_EMBEDDING_SETTINGS);
}

export function areCodeEmbeddingSettingsEqual(
	left: RuntimeCodeEmbeddingSettings | null,
	right: RuntimeCodeEmbeddingSettings | null,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

// §5.AL model-capability gate policy normalizers (global default + per-project override), mirroring the codeEmbedding pair.
export const DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG = DEFAULT_RUNTIME_MODEL_SUITABILITY_POLICY;
export function normalizeModelSuitabilityPolicy(
	value: unknown,
	fallback: RuntimeModelSuitabilityPolicy,
): RuntimeModelSuitabilityPolicy {
	const parsed = runtimeModelSuitabilityPolicySchema.safeParse(value);
	return parsed.success ? parsed.data : fallback;
}
export function normalizeModelSuitabilityPolicyOverride(value: unknown): RuntimeModelSuitabilityPolicy | null {
	if (value === null || value === undefined) {
		return null;
	}
	const parsed = runtimeModelSuitabilityPolicySchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
export function areModelSuitabilityPoliciesEqual(
	left: RuntimeModelSuitabilityPolicy | null,
	right: RuntimeModelSuitabilityPolicy | null,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

// §5.AE skill-dynamics level normalizers (global default + per-project override), mirroring the suitability-policy pair.
export const DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG = DEFAULT_RUNTIME_SKILL_DYNAMICS_LEVEL;
export function normalizeSkillDynamicsLevel(
	value: unknown,
	fallback: RuntimeSkillDynamicsLevel,
): RuntimeSkillDynamicsLevel {
	const parsed = runtimeSkillDynamicsLevelSchema.safeParse(value);
	return parsed.success ? parsed.data : fallback;
}
export function normalizeSkillDynamicsLevelOverride(value: unknown): RuntimeSkillDynamicsLevel | null {
	if (value === null || value === undefined) {
		return null;
	}
	const parsed = runtimeSkillDynamicsLevelSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
export function areSkillDynamicsLevelsEqual(
	left: RuntimeSkillDynamicsLevel | null,
	right: RuntimeSkillDynamicsLevel | null,
): boolean {
	return left === right;
}
