import { normalizeModelRoles, normalizeModelRolesOverride } from "./runtime-config-normalizers";
import type {
	RuntimeConfigState,
	RuntimeGlobalConfigFileShape,
	RuntimeProjectConfigFileShape,
} from "./runtime-config-types";

/** The model-roles fields of the resolved runtime config (defaults + override + effective). */
export type RuntimeModelRolesConfigFields = Pick<
	RuntimeConfigState,
	"modelRoles" | "modelRolesOverride" | "effectiveModelRoles"
>;

/**
 * Resolve the model-roles block from the global + project configs, with the
 * `effective = override ?? default` derivation. Extracted from the toRuntimeConfigState builder
 * (§5.U) as a focused, independently tested override-pattern sub-resolver.
 */
/** Derive the model-roles fields from raw default + override values (shared by the resolver and the flat-values builder). */
export function deriveModelRolesFields(
	defaultValue: Parameters<typeof normalizeModelRoles>[0],
	overrideValue: Parameters<typeof normalizeModelRolesOverride>[0],
): RuntimeModelRolesConfigFields {
	const modelRoles = normalizeModelRoles(defaultValue);
	const modelRolesOverride = normalizeModelRolesOverride(overrideValue);
	return {
		modelRoles,
		modelRolesOverride,
		effectiveModelRoles: modelRolesOverride ?? modelRoles,
	};
}

export function resolveRuntimeModelRolesConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
	projectConfig: RuntimeProjectConfigFileShape | null,
): RuntimeModelRolesConfigFields {
	return deriveModelRolesFields(globalConfig?.modelRoles, projectConfig?.modelRolesOverride);
}
