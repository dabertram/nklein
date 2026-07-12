import { areRuntimeSwarmGuardrailsEqual } from "../core/api-contract";
import { areConcurrencyConfigsEqual, areConcurrencyOverridesEqual } from "../core/concurrency-config";
import {
	areAgentRulesetsEqual,
	areCodeEmbeddingSettingsEqual,
	areModelRolesEqual,
	areModelSuitabilityPoliciesEqual,
	areSkillDynamicsLevelsEqual,
} from "./runtime-config-normalizers";
import type { RuntimeConfigState } from "./runtime-config-types";
import { areRuntimeProjectShortcutsEqual } from "./shortcut-utils";

// Field-descriptor registry for runtime-config save-time change detection (extracted from
// runtime-config.ts, §5.U). The change-detection input is a resolved config minus the derived/path
// fields a save never round-trips (those are recomputed on load), so the partial `nextConfig` the
// update functions build satisfies it too. Each field compares by `!==` by default, or a custom
// deep-equality for nested objects/arrays.
export type RuntimeConfigChangeComparable = Omit<
	RuntimeConfigState,
	| "globalConfigPath"
	| "projectConfigPath"
	| "effectiveCodeEmbeddingSettings"
	| "effectiveModelSuitabilityPolicy"
	| "effectiveSkillDynamicsLevel"
	| "effectiveFileOverlapParallelism"
	| "effectiveMaxConcurrentTasks"
	| "effectiveSelectedAgentId"
	| "effectiveModelRoles"
	| "effectiveSandboxIsolationProfile"
	| "commitPromptTemplateDefault"
	| "openPrPromptTemplateDefault"
>;

export interface RuntimeConfigChangeField {
	key: keyof RuntimeConfigChangeComparable;
	changed: (next: RuntimeConfigChangeComparable, current: RuntimeConfigChangeComparable) => boolean;
}

function runtimeConfigChangeField<K extends keyof RuntimeConfigChangeComparable>(
	key: K,
	equals?: (a: RuntimeConfigChangeComparable[K], b: RuntimeConfigChangeComparable[K]) => boolean,
): RuntimeConfigChangeField {
	return {
		key,
		changed: (next, current) => (equals ? !equals(next[key], current[key]) : next[key] !== current[key]),
	};
}

// Global-scoped fields (written to the global config file). Order is irrelevant to the result (it's an OR).
export const RUNTIME_GLOBAL_CONFIG_CHANGE_FIELDS: readonly RuntimeConfigChangeField[] = [
	runtimeConfigChangeField("selectedAgentId"),
	runtimeConfigChangeField("selectedShortcutLabel"),
	runtimeConfigChangeField("developerModeEnabled"),
	runtimeConfigChangeField("replayCardsEnabled"),
	runtimeConfigChangeField("setupWizardCompletedAt"),
	runtimeConfigChangeField("knowsTodayEnabled"),
	runtimeConfigChangeField("sandboxMcpServersEnabled"),
	runtimeConfigChangeField("basicMemoryEnabled"),
	runtimeConfigChangeField("chatAdaptiveTruncationEnabled"),
	runtimeConfigChangeField("reasoningBudgetEnabled"),
	runtimeConfigChangeField("reviewLensesEnabled"),
	runtimeConfigChangeField("capabilityBrokerEnabled"),
	runtimeConfigChangeField("modelStatsTrackingLevel"),
	runtimeConfigChangeField("retrievalEgressEnabled"),
	runtimeConfigChangeField("retrievalSearchBackendUrl"),
	runtimeConfigChangeField("llmfitCatalogUpdateMode"),
	runtimeConfigChangeField("speculativeBestOfNEnabled"),
	runtimeConfigChangeField("speculativeMaxConcurrentSpecs"),
	runtimeConfigChangeField("speculativeMaxSpecsPerRun"),
	runtimeConfigChangeField("agentAutonomousModeEnabled"),
	runtimeConfigChangeField("agentTimeoutMode"),
	runtimeConfigChangeField("agentTimeoutProfile"),
	runtimeConfigChangeField("requestTimeoutMs"),
	runtimeConfigChangeField("streamTimeoutMs"),
	runtimeConfigChangeField("toolTimeoutMs"),
	runtimeConfigChangeField("agentTimeoutMs"),
	runtimeConfigChangeField("conversationTimeoutMs"),
	runtimeConfigChangeField("maxAgentWritableFileLines"),
	runtimeConfigChangeField("maxConcurrentTasks"),
	runtimeConfigChangeField("sandboxMaxContainers"),
	runtimeConfigChangeField("sandboxAgentsPerContainer"),
	runtimeConfigChangeField("sandboxMemoryPerContainerMb"),
	runtimeConfigChangeField("sandboxCpusPerContainer"),
	runtimeConfigChangeField("sandboxMaxConcurrentExec"),
	runtimeConfigChangeField("sandboxIdleTimeoutMinutes"),
	runtimeConfigChangeField("sandboxIsolationProfileDefault"),
	runtimeConfigChangeField("lostHeartbeatPolicy"),
	runtimeConfigChangeField("decompositionAutoApplyEnabled"),
	runtimeConfigChangeField("hardTaskRoutingMode"),
	runtimeConfigChangeField("testDrivenModeEnabled"),
	runtimeConfigChangeField("secondOpinionReviewEnabled"),
	runtimeConfigChangeField("reviewMaxRounds"),
	runtimeConfigChangeField("readyForReviewNotificationsEnabled"),
	runtimeConfigChangeField("codeEmbeddingDefaults", areCodeEmbeddingSettingsEqual),
	runtimeConfigChangeField("modelSuitabilityPolicyDefaults", areModelSuitabilityPoliciesEqual),
	runtimeConfigChangeField("skillDynamicsLevelDefault", areSkillDynamicsLevelsEqual),
	runtimeConfigChangeField("fileOverlapParallelism"),
	runtimeConfigChangeField("concurrencyDefaults", areConcurrencyConfigsEqual),
	runtimeConfigChangeField("modelRoles", areModelRolesEqual),
	runtimeConfigChangeField("agentRulesets", areAgentRulesetsEqual),
	runtimeConfigChangeField("swarmGuardrails", areRuntimeSwarmGuardrailsEqual),
	runtimeConfigChangeField("commitPromptTemplate"),
	runtimeConfigChangeField("openPrPromptTemplate"),
	runtimeConfigChangeField("workspaceBaseDir"),
	runtimeConfigChangeField("deviceRamGb"),
];

// Project-scoped save additionally diffs the project-only fields (the per-project override + shortcuts).
export const RUNTIME_PROJECT_CONFIG_CHANGE_FIELDS: readonly RuntimeConfigChangeField[] = [
	...RUNTIME_GLOBAL_CONFIG_CHANGE_FIELDS,
	runtimeConfigChangeField("projectSetupWizardCompletedAt"),
	runtimeConfigChangeField("codeEmbeddingOverride", areCodeEmbeddingSettingsEqual),
	runtimeConfigChangeField("modelSuitabilityPolicyOverride", areModelSuitabilityPoliciesEqual),
	runtimeConfigChangeField("skillDynamicsLevelOverride", areSkillDynamicsLevelsEqual),
	runtimeConfigChangeField("fileOverlapParallelismOverride"),
	runtimeConfigChangeField("concurrencyOverride", areConcurrencyOverridesEqual),
	runtimeConfigChangeField("maxConcurrentTasksOverride"),
	runtimeConfigChangeField("selectedAgentIdOverride"),
	runtimeConfigChangeField("agentRulesetsOverride", (a, b) => areAgentRulesetsEqual(a ?? undefined, b ?? undefined)),
	runtimeConfigChangeField("modelRolesOverride", (a, b) => areModelRolesEqual(a ?? {}, b ?? {})),
	runtimeConfigChangeField("sandboxIsolationProfileOverride"),
	runtimeConfigChangeField("shortcuts", areRuntimeProjectShortcutsEqual),
];

/** Derived/path fields a save never round-trips (recomputed on load), excluded from change detection. */
export const RUNTIME_CONFIG_DERIVED_FIELD_KEYS = [
	"globalConfigPath",
	"projectConfigPath",
	"effectiveCodeEmbeddingSettings",
	"effectiveModelSuitabilityPolicy",
	"effectiveSkillDynamicsLevel",
	"effectiveFileOverlapParallelism",
	"effectiveMaxConcurrentTasks",
	"effectiveSelectedAgentId",
	"effectiveAgentRulesets",
	"effectiveModelRoles",
	"effectiveSandboxIsolationProfile",
	"commitPromptTemplateDefault",
	"openPrPromptTemplateDefault",
] as const satisfies readonly (keyof RuntimeConfigState)[];

/** The keys diffed by a project-scoped save (the full comparable set). Exposed for a completeness guard. */
export const RUNTIME_PROJECT_CONFIG_CHANGE_FIELD_KEYS: readonly (keyof RuntimeConfigChangeComparable)[] =
	RUNTIME_PROJECT_CONFIG_CHANGE_FIELDS.map((field) => field.key);

export function runtimeConfigStateHasChanges(
	fields: readonly RuntimeConfigChangeField[],
	next: RuntimeConfigChangeComparable,
	current: RuntimeConfigChangeComparable,
): boolean {
	return fields.some((field) => field.changed(next, current));
}
