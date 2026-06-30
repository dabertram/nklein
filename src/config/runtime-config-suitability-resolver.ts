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
/** Derive the model-suitability fields from raw default + override values (shared by the file-shape resolver and the flat-values builder, so they can't drift). */
export function deriveSuitabilityFields(
	defaultsValue: Parameters<typeof normalizeModelSuitabilityPolicy>[0],
	overrideValue: Parameters<typeof normalizeModelSuitabilityPolicyOverride>[0],
): RuntimeSuitabilityConfigFields {
	const modelSuitabilityPolicyDefaults = normalizeModelSuitabilityPolicy(
		defaultsValue,
		DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG,
	);
	const modelSuitabilityPolicyOverride = normalizeModelSuitabilityPolicyOverride(overrideValue);
	return {
		modelSuitabilityPolicyDefaults,
		modelSuitabilityPolicyOverride,
		effectiveModelSuitabilityPolicy: modelSuitabilityPolicyOverride ?? modelSuitabilityPolicyDefaults,
	};
}

export function resolveRuntimeSuitabilityConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
	projectConfig: RuntimeProjectConfigFileShape | null,
): RuntimeSuitabilityConfigFields {
	return deriveSuitabilityFields(
		globalConfig?.modelSuitabilityPolicyDefaults,
		projectConfig?.modelSuitabilityPolicyOverride,
	);
}
