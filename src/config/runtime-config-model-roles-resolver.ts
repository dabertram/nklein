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
export function resolveRuntimeModelRolesConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
	projectConfig: RuntimeProjectConfigFileShape | null,
): RuntimeModelRolesConfigFields {
	const modelRoles = normalizeModelRoles(globalConfig?.modelRoles);
	const modelRolesOverride = normalizeModelRolesOverride(projectConfig?.modelRolesOverride);
	return {
		modelRoles,
		modelRolesOverride,
		effectiveModelRoles: modelRolesOverride ?? modelRoles,
	};
}
