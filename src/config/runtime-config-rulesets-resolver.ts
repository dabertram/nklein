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
export function resolveRuntimeRulesetsConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
	projectConfig: RuntimeProjectConfigFileShape | null,
): RuntimeRulesetsConfigFields {
	const agentRulesetsOverride = normalizeAgentRulesetsOverride(projectConfig?.agentRulesetsOverride);
	const agentRulesets = normalizeAgentRulesets(globalConfig?.agentRulesets);
	return {
		agentRulesets,
		agentRulesetsOverride,
		effectiveAgentRulesets: agentRulesetsOverride ?? agentRulesets,
	};
}
