import {
	DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG,
	normalizeSkillDynamicsLevel,
	normalizeSkillDynamicsLevelOverride,
} from "./runtime-config-normalizers";
import type {
	RuntimeConfigState,
	RuntimeGlobalConfigFileShape,
	RuntimeProjectConfigFileShape,
} from "./runtime-config-types";

/** The skill-dynamics level fields of the resolved runtime config (default + override + effective). */
export type RuntimeSkillDynamicsConfigFields = Pick<
	RuntimeConfigState,
	"skillDynamicsLevelDefault" | "skillDynamicsLevelOverride" | "effectiveSkillDynamicsLevel"
>;

/**
 * Resolve the skill-dynamics level block from the global + project configs, with the
 * `effective = override ?? default` derivation. Extracted from the toRuntimeConfigState builder
 * (§5.U) as a focused, independently tested override-pattern sub-resolver.
 */
export function resolveRuntimeSkillDynamicsConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
	projectConfig: RuntimeProjectConfigFileShape | null,
): RuntimeSkillDynamicsConfigFields {
	const skillDynamicsLevelDefault = normalizeSkillDynamicsLevel(
		globalConfig?.skillDynamicsLevelDefault,
		DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG,
	);
	const skillDynamicsLevelOverride = normalizeSkillDynamicsLevelOverride(projectConfig?.skillDynamicsLevelOverride);
	return {
		skillDynamicsLevelDefault,
		skillDynamicsLevelOverride,
		effectiveSkillDynamicsLevel: skillDynamicsLevelOverride ?? skillDynamicsLevelDefault,
	};
}
