import { areRuntimeSwarmGuardrailsEqual } from "@runtime-contract";
import { inputsToSwarmGuardrails } from "@/components/runtime-settings-swarm-guardrails";
import {
	type SettingsConfigSnapshot,
	type SettingsDraft,
	snapshotSwarmGuardrailInputs,
} from "@/features/settings/settings-draft";

/**
 * F1.29 — the per-SECTION draft boundary over the proven whole-dialog draft machinery: every `SettingsDraft`
 * field belongs to EXACTLY ONE section (locked by a test), and each section gets an independent typed contract —
 * `isSectionDirty` / `resetSection` / `dirtySections` — so config-heavy work edits one section's slice instead of
 * the monolithic dialog state. The dialog adopts per-section Save/Reset incrementally (the F1.29 follow-up
 * leaves); this module is the boundary itself and changes no behavior on its own.
 *
 * Comparison rules mirror `isSettingsDraftDirty` exactly: numeric-string inputs compare TRIMMED, structured
 * values compare deeply, and the swarm-guardrail form inputs compare through the SAME structural equality the
 * whole-dialog check uses (`inputsToSwarmGuardrails` vs the snapshot's structured guardrails).
 */

export const SETTINGS_SECTION_FIELDS = {
	agent: ["selectedAgentId", "agentAutonomousModeEnabled", "selectedAgentIdOverride"],
	timeouts: [
		"agentTimeoutMode",
		"agentTimeoutProfile",
		"requestTimeoutMs",
		"streamTimeoutMs",
		"toolTimeoutMs",
		"agentTimeoutMs",
		"conversationTimeoutMs",
		"lostHeartbeatPolicy",
	],
	concurrency: ["maxConcurrentTasks", "concurrencyDefaults", "concurrencyOverride", "maxConcurrentTasksOverride"],
	sandbox: [
		"workspaceBaseDir",
		"deviceRamGb",
		"sandboxEgressProxyEnabled",
		"sandboxEgressAllowlist",
		"sandboxMaxContainers",
		"sandboxAgentsPerContainer",
		"sandboxMemoryPerContainerMb",
		"sandboxCpusPerContainer",
		"sandboxIdleTimeoutMinutes",
		"sandboxIsolationProfileDefault",
		"sandboxMcpServersEnabled",
	],
	planning_review: [
		"decompositionAutoApplyEnabled",
		"testDrivenModeEnabled",
		"hardTaskRoutingMode",
		"secondOpinionReviewEnabled",
		"reviewMaxRounds",
		"reviewLensesEnabled",
		"speculativeBestOfNEnabled",
		"speculativeMaxConcurrentSpecs",
		"speculativeMaxSpecsPerRun",
	],
	models: [
		"modelRoles",
		"modelRolesOverride",
		"modelGateUnsuitable",
		"modelGateUnknown",
		"llmfitCatalogUpdateMode",
		"codeEmbeddingDefaults",
		"codeEmbeddingOverride",
	],
	rulesets_guardrails: [
		"agentRulesets",
		"agentRulesetsOverride",
		"swarmGuardrailInputs",
		"maxAgentWritableFileLines",
		"capabilityBrokerEnabled",
		"skillDynamicsLevel",
		"skillDynamicsLevelOverride",
	],
	features: [
		"developerModeEnabled",
		"replayCardsEnabled",
		"knowsTodayEnabled",
		"retrievalEgressEnabled",
		"retrievalSearchBackendUrl",
		"basicMemoryEnabled",
		"chatAdaptiveTruncationEnabled",
		"reasoningBudgetEnabled",
		"readyForReviewNotificationsEnabled",
	],
	shortcuts_templates: ["shortcuts", "commitPromptTemplate", "openPrPromptTemplate"],
} as const satisfies Record<string, readonly (keyof SettingsDraft)[]>;

export type SettingsSectionId = keyof typeof SETTINGS_SECTION_FIELDS;

export const SETTINGS_SECTION_IDS = Object.keys(SETTINGS_SECTION_FIELDS) as SettingsSectionId[];

/** Numeric-string inputs compare TRIMMED (mirrors isSettingsDraftDirty's rule for the raw form strings). */
const TRIMMED_STRING_FIELDS = new Set<keyof SettingsDraft>([
	"requestTimeoutMs",
	"streamTimeoutMs",
	"toolTimeoutMs",
	"agentTimeoutMs",
	"conversationTimeoutMs",
	"maxAgentWritableFileLines",
	"maxConcurrentTasks",
	"sandboxMaxContainers",
	"sandboxAgentsPerContainer",
	"sandboxMemoryPerContainerMb",
	"sandboxCpusPerContainer",
	"sandboxIdleTimeoutMinutes",
	"deviceRamGb",
]);

function fieldDirty(field: keyof SettingsDraft, draft: SettingsDraft, snapshot: SettingsConfigSnapshot): boolean {
	if (field === "swarmGuardrailInputs") {
		return !areRuntimeSwarmGuardrailsEqual(
			inputsToSwarmGuardrails(draft.swarmGuardrailInputs),
			snapshot.swarmGuardrails,
		);
	}
	const draftValue = draft[field];
	const snapshotValue = snapshot[field as keyof SettingsConfigSnapshot];
	if (typeof draftValue === "string" && typeof snapshotValue === "string" && TRIMMED_STRING_FIELDS.has(field)) {
		return draftValue.trim() !== snapshotValue.trim();
	}
	if (draftValue !== null && typeof draftValue === "object") {
		return JSON.stringify(draftValue) !== JSON.stringify(snapshotValue);
	}
	return draftValue !== snapshotValue;
}

/** Whether ONE section's slice of the draft differs from the config snapshot. */
export function isSectionDirty(
	section: SettingsSectionId,
	draft: SettingsDraft,
	snapshot: SettingsConfigSnapshot,
): boolean {
	return SETTINGS_SECTION_FIELDS[section].some((field) => fieldDirty(field, draft, snapshot));
}

/** Every dirty section, in declaration order — the per-section dirty indicator + targeted-save basis. */
export function dirtySections(draft: SettingsDraft, snapshot: SettingsConfigSnapshot): SettingsSectionId[] {
	return SETTINGS_SECTION_IDS.filter((section) => isSectionDirty(section, draft, snapshot));
}

/** A new draft with ONE section reset to the snapshot's values; every other section keeps its edits. */
export function resetSection(
	section: SettingsSectionId,
	draft: SettingsDraft,
	snapshot: SettingsConfigSnapshot,
): SettingsDraft {
	const next: SettingsDraft = { ...draft };
	for (const field of SETTINGS_SECTION_FIELDS[section]) {
		if (field === "swarmGuardrailInputs") {
			next.swarmGuardrailInputs = snapshotSwarmGuardrailInputs(snapshot);
			continue;
		}
		(next as unknown as Record<string, unknown>)[field] = snapshot[field as keyof SettingsConfigSnapshot];
	}
	return next;
}
