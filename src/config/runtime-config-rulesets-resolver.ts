import { normalizeAgentRulesets, normalizeAgentRulesetsOverride } from "./runtime-config-normalizers";
import type {
	RuntimeConfigState,
	RuntimeGlobalConfigFileShape,
	RuntimeProjectConfigFileShape,
} from "./runtime-config-types";

/** The per-agent ruleset fields of the resolved runtime config (defaults + override + effective). */
export type RuntimeRulesetsConfigFields = Pick<
	RuntimeConfigState,
	"agentRulesets" | "agentRulesetsOverride" | "effectiveAgentRulesets"
>;

/**
 * Resolve the agent-rulesets block from the global + project configs, with the
 * `effective = override ?? default` derivation. Extracted from the toRuntimeConfigState builder
 * (§5.U) as a focused, independently tested override-pattern sub-resolver.
 */
/** Derive the agent-rulesets fields from raw default + override values (shared by the resolver and the flat-values builder). */
export function deriveRulesetsFields(
	defaultValue: Parameters<typeof normalizeAgentRulesets>[0],
	overrideValue: Parameters<typeof normalizeAgentRulesetsOverride>[0],
): RuntimeRulesetsConfigFields {
	const agentRulesetsOverride = normalizeAgentRulesetsOverride(overrideValue);
	const agentRulesets = normalizeAgentRulesets(defaultValue);
	return {
		agentRulesets,
		agentRulesetsOverride,
		effectiveAgentRulesets: agentRulesetsOverride ?? agentRulesets,
	};
}

export function resolveRuntimeRulesetsConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
	projectConfig: RuntimeProjectConfigFileShape | null,
): RuntimeRulesetsConfigFields {
	return deriveRulesetsFields(globalConfig?.agentRulesets, projectConfig?.agentRulesetsOverride);
}
