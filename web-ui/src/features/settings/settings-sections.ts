import { areRuntimeSwarmGuardrailsEqual } from "@runtime-contract";
import { inputsToSwarmGuardrails } from "@/components/runtime-settings-swarm-guardrails";
import type { SettingsNavId } from "@/components/settings-nav";
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

/** A new draft with `fields` reset to the snapshot's values; every other field keeps its edits. */
function resetFields(
	fields: readonly (keyof SettingsDraft)[],
	draft: SettingsDraft,
	snapshot: SettingsConfigSnapshot,
): SettingsDraft {
	const next: SettingsDraft = { ...draft };
	for (const field of fields) {
		if (field === "swarmGuardrailInputs") {
			next.swarmGuardrailInputs = snapshotSwarmGuardrailInputs(snapshot);
			continue;
		}
		(next as unknown as Record<string, unknown>)[field] = snapshot[field as keyof SettingsConfigSnapshot];
	}
	return next;
}

/** A new draft with ONE section reset to the snapshot's values; every other section keeps its edits. */
export function resetSection(
	section: SettingsSectionId,
	draft: SettingsDraft,
	snapshot: SettingsConfigSnapshot,
): SettingsDraft {
	return resetFields(SETTINGS_SECTION_FIELDS[section], draft, snapshot);
}

/**
 * F1.29b — the NAV-ALIGNED dirty/reset axis. {@link SETTINGS_SECTION_FIELDS} partitions the draft by STATE domain
 * (each field in exactly one section), but the dialog's nav tabs group the SAME fields differently — a single draft
 * section (e.g. `sandbox`) renders its controls across several nav tabs. So per-TAB dirty indicators + a per-tab
 * Reset need this second map: the editable draft fields rendered UNDER each nav tab. It is populated ONE TAB PER LEAF
 * (F1.29b) — a nav tab absent here simply has no per-tab affordance yet, and a tab's entry must list EVERY editable
 * draft field rendered in that tab's body region (else its dirty dot would miss a change). Values reuse the SAME
 * {@link fieldDirty} comparison as the whole-dialog dirty check, so a per-tab indicator can never disagree with Save.
 */
export const SETTINGS_NAV_FIELDS: Partial<Record<SettingsNavId, readonly (keyof SettingsDraft)[]>> = {
	general: [
		"developerModeEnabled",
		"replayCardsEnabled",
		"knowsTodayEnabled",
		"chatAdaptiveTruncationEnabled",
		"reasoningBudgetEnabled",
		"retrievalEgressEnabled",
		"retrievalSearchBackendUrl",
		"sandboxMcpServersEnabled",
		"basicMemoryEnabled",
		"capabilityBrokerEnabled",
		"maxAgentWritableFileLines",
	],
	// NOTE: the Tasks tab ALSO renders local (non-draft) task-default controls; its dirty dot ORs those in at the
	// dialog (see `dirtyNavIdSet`), so this draft-field list alone would UNDER-report — never read it in isolation
	// for the Tasks tab.
	tasks: ["workspaceBaseDir", "deviceRamGb", "agentRulesets"],
	guardrails: ["maxConcurrentTasks", "swarmGuardrailInputs"],
	"git-prompts": ["commitPromptTemplate", "openPrPromptTemplate"],
	notifications: ["readyForReviewNotificationsEnabled"],
};

/** Whether any editable field rendered under ONE nav tab differs from the config snapshot. */
export function isNavSectionDirty(nav: SettingsNavId, draft: SettingsDraft, snapshot: SettingsConfigSnapshot): boolean {
	const fields = SETTINGS_NAV_FIELDS[nav];
	return fields ? fields.some((field) => fieldDirty(field, draft, snapshot)) : false;
}

/** Every nav tab (with a per-tab affordance) whose slice is dirty — the per-tab dirty-dot basis. */
export function dirtyNavSections(draft: SettingsDraft, snapshot: SettingsConfigSnapshot): SettingsNavId[] {
	return (Object.keys(SETTINGS_NAV_FIELDS) as SettingsNavId[]).filter((nav) =>
		isNavSectionDirty(nav, draft, snapshot),
	);
}

/** A new draft with ONE nav tab's editable fields reset to the snapshot; every other field keeps its edits. */
export function resetNavSection(
	nav: SettingsNavId,
	draft: SettingsDraft,
	snapshot: SettingsConfigSnapshot,
): SettingsDraft {
	return resetFields(SETTINGS_NAV_FIELDS[nav] ?? [], draft, snapshot);
}
