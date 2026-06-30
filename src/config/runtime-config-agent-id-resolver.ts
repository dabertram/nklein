import { normalizeAgentId, normalizeSelectedAgentIdOverride } from "./runtime-config-normalizers";
import type {
	RuntimeConfigState,
	RuntimeGlobalConfigFileShape,
	RuntimeProjectConfigFileShape,
} from "./runtime-config-types";

/** The selected-agent-id fields of the resolved runtime config (default + override + effective). */
export type RuntimeAgentIdConfigFields = Pick<
	RuntimeConfigState,
	"selectedAgentId" | "selectedAgentIdOverride" | "effectiveSelectedAgentId"
>;

/**
 * Resolve the selected-agent-id block from the global + project configs, with the
 * `effective = override ?? default` derivation. Extracted from the toRuntimeConfigState builder
 * (§5.U) as a focused, independently tested override-pattern sub-resolver — the last of the
 * override groups.
 */
/** Derive the agent-id fields from raw default + override values (shared by the resolver and the flat-values builder). */
export function deriveAgentIdFields(
	defaultValue: Parameters<typeof normalizeAgentId>[0],
	overrideValue: Parameters<typeof normalizeSelectedAgentIdOverride>[0],
): RuntimeAgentIdConfigFields {
	const selectedAgentId = normalizeAgentId(defaultValue);
	const selectedAgentIdOverride = normalizeSelectedAgentIdOverride(overrideValue);
	return {
		selectedAgentId,
		selectedAgentIdOverride,
		effectiveSelectedAgentId: selectedAgentIdOverride ?? selectedAgentId,
	};
}

export function resolveRuntimeAgentIdConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
	projectConfig: RuntimeProjectConfigFileShape | null,
): RuntimeAgentIdConfigFields {
	return deriveAgentIdFields(globalConfig?.selectedAgentId, projectConfig?.selectedAgentIdOverride);
}
