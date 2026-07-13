import type { RuntimeNKleinReasoningEffort } from "../core/api-contract";

/**
 * The per-task launch overrides captured at start and re-applied on a restart-from-persistence (todo §5.G/§5.U). Every
 * optional field is "absent ⇒ leave unchanged" — the normalizer preserves that distinction (present-but-null clears;
 * absent is omitted).
 */
export interface NKleinTaskLaunchConfigOverrides {
	providerId: string;
	modelId: string;
	workspaceRoot?: string | null;
	filesLikelyTouched?: readonly string[] | null;
	writeScope?: readonly string[] | null;
	forbiddenPaths?: readonly string[] | null;
	apiKey?: string | null;
	baseUrl?: string | null;
	reasoningEffort?: RuntimeNKleinReasoningEffort | null;
	contextWindow?: number | null;
	apiTimeoutMs?: number | null;
	turnTimeoutMs?: number | null;
	/** W1.1: per-turn output-token budget override (the §5.AA budget-raise retry lever); absent ⇒ unchanged. */
	maxTokensPerTurn?: number | null;
}

export interface NKleinTaskRestartLaunchConfig extends NKleinTaskLaunchConfigOverrides {
	maxAgentWritableFileLines?: number | null;
}

/**
 * §5.U — normalize a launch config for caching: trim/canonicalize `providerId` (lowercased) + `modelId` + the URL/root
 * strings, and preserve each OPTIONAL field's presence with `Object.hasOwn` so "absent" (leave unchanged) stays distinct
 * from "present-but-null" (clear). Pure; extracted from `InMemoryNKleinTaskSessionService.cacheLaunchConfig` so this
 * subtle present-vs-absent contract is unit-testable; the caller keeps the store writes.
 */
export function normalizeLaunchConfig(launchConfig: NKleinTaskRestartLaunchConfig): NKleinTaskRestartLaunchConfig {
	return {
		providerId: launchConfig.providerId.trim().toLowerCase(),
		modelId: launchConfig.modelId.trim(),
		...(Object.hasOwn(launchConfig, "workspaceRoot")
			? { workspaceRoot: launchConfig.workspaceRoot?.trim() || null }
			: {}),
		...(Object.hasOwn(launchConfig, "writeScope") ? { writeScope: launchConfig.writeScope ?? null } : {}),
		...(Object.hasOwn(launchConfig, "forbiddenPaths") ? { forbiddenPaths: launchConfig.forbiddenPaths ?? null } : {}),
		...(Object.hasOwn(launchConfig, "filesLikelyTouched")
			? { filesLikelyTouched: launchConfig.filesLikelyTouched ?? null }
			: {}),
		...(Object.hasOwn(launchConfig, "apiKey") ? { apiKey: launchConfig.apiKey } : {}),
		...(Object.hasOwn(launchConfig, "baseUrl") ? { baseUrl: launchConfig.baseUrl?.trim() || null } : {}),
		...(Object.hasOwn(launchConfig, "reasoningEffort") ? { reasoningEffort: launchConfig.reasoningEffort } : {}),
		...(Object.hasOwn(launchConfig, "contextWindow") ? { contextWindow: launchConfig.contextWindow } : {}),
		...(Object.hasOwn(launchConfig, "maxAgentWritableFileLines")
			? { maxAgentWritableFileLines: launchConfig.maxAgentWritableFileLines }
			: {}),
		...(Object.hasOwn(launchConfig, "apiTimeoutMs") ? { apiTimeoutMs: launchConfig.apiTimeoutMs } : {}),
		...(Object.hasOwn(launchConfig, "turnTimeoutMs") ? { turnTimeoutMs: launchConfig.turnTimeoutMs } : {}),
	};
}
