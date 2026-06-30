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
/** Derive the skill-dynamics fields from raw default + override values (shared by the resolver and the flat-values builder). */
export function deriveSkillDynamicsFields(
	defaultValue: Parameters<typeof normalizeSkillDynamicsLevel>[0],
	overrideValue: Parameters<typeof normalizeSkillDynamicsLevelOverride>[0],
): RuntimeSkillDynamicsConfigFields {
	const skillDynamicsLevelDefault = normalizeSkillDynamicsLevel(defaultValue, DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG);
	const skillDynamicsLevelOverride = normalizeSkillDynamicsLevelOverride(overrideValue);
	return {
		skillDynamicsLevelDefault,
		skillDynamicsLevelOverride,
		effectiveSkillDynamicsLevel: skillDynamicsLevelOverride ?? skillDynamicsLevelDefault,
	};
}

export function resolveRuntimeSkillDynamicsConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
	projectConfig: RuntimeProjectConfigFileShape | null,
): RuntimeSkillDynamicsConfigFields {
	return deriveSkillDynamicsFields(globalConfig?.skillDynamicsLevelDefault, projectConfig?.skillDynamicsLevelOverride);
}
