import {
	DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG,
	normalizeModelSuitabilityPolicy,
	normalizeModelSuitabilityPolicyOverride,
} from "./runtime-config-normalizers";
import type {
	RuntimeConfigState,
	RuntimeGlobalConfigFileShape,
	RuntimeProjectConfigFileShape,
} from "./runtime-config-types";

/** The model-suitability policy fields of the resolved runtime config (defaults + override + effective). */
export type RuntimeSuitabilityConfigFields = Pick<
	RuntimeConfigState,
	"modelSuitabilityPolicyDefaults" | "modelSuitabilityPolicyOverride" | "effectiveModelSuitabilityPolicy"
>;

/**
 * Resolve the model-suitability policy block from the global + project configs, with the
 * `effective = override ?? default` derivation. Extracted from the toRuntimeConfigState builder
 * (§5.U) as a focused, independently tested override-pattern sub-resolver.
 */
export function resolveRuntimeSuitabilityConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
	projectConfig: RuntimeProjectConfigFileShape | null,
): RuntimeSuitabilityConfigFields {
	const modelSuitabilityPolicyDefaults = normalizeModelSuitabilityPolicy(
		globalConfig?.modelSuitabilityPolicyDefaults,
		DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG,
	);
	const modelSuitabilityPolicyOverride = normalizeModelSuitabilityPolicyOverride(
		projectConfig?.modelSuitabilityPolicyOverride,
	);
	return {
		modelSuitabilityPolicyDefaults,
		modelSuitabilityPolicyOverride,
		effectiveModelSuitabilityPolicy: modelSuitabilityPolicyOverride ?? modelSuitabilityPolicyDefaults,
	};
}
