/**
 * §5.W (user 2026-07-12, todo §10c#9): derive which PER-PROJECT overrides are ACTIVE from the runtime config
 * response, so the Settings nav can badge the Project entry — the at-a-glance "this project diverges from global"
 * signal. Pure over the wire shape; an override counts as active when it is set (non-null / non-empty).
 */

/**
 * The subset of RuntimeConfigResponse this helper reads (structural + value-agnostic: only null/undefined-ness
 * matters, so the wire types can evolve without touching this).
 */
export interface ProjectOverrideFields {
	maxConcurrentTasksOverride?: unknown;
	selectedAgentIdOverride?: unknown;
	sandboxIsolationProfileOverride?: unknown;
	codeEmbeddingOverride?: unknown;
	concurrencyOverride?: unknown;
	modelSuitabilityPolicyOverride?: unknown;
	skillDynamicsLevelOverride?: unknown;
	fileOverlapParallelismOverride?: unknown;
	modelRolesOverride?: unknown;
	agentRulesetsOverride?: unknown;
}

/** Human labels for each active per-project override, in a stable display order. Empty when nothing diverges. */
export function listActiveProjectOverrides(config: ProjectOverrideFields | null | undefined): string[] {
	if (!config) {
		return [];
	}
	const active: string[] = [];
	const push = (value: unknown, label: string): void => {
		if (value !== null && value !== undefined) {
			active.push(label);
		}
	};
	push(config.maxConcurrentTasksOverride, "Max concurrent tasks");
	push(config.selectedAgentIdOverride, "Agent");
	push(config.sandboxIsolationProfileOverride, "Sandbox isolation");
	push(config.codeEmbeddingOverride, "Code embeddings");
	push(config.concurrencyOverride, "Concurrency caps");
	push(config.modelSuitabilityPolicyOverride, "Model suitability");
	push(config.skillDynamicsLevelOverride, "Skill dynamics");
	push(config.fileOverlapParallelismOverride, "File-overlap parallelism");
	push(config.modelRolesOverride, "Model roles");
	push(config.agentRulesetsOverride, "Agent rulesets");
	return active;
}
