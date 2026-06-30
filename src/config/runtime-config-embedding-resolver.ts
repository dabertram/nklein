import { DEFAULT_CODE_EMBEDDING_SETTINGS } from "./runtime-config-defaults";
import { normalizeCodeEmbeddingOverride, normalizeCodeEmbeddingSettings } from "./runtime-config-normalizers";
import type {
	RuntimeConfigState,
	RuntimeGlobalConfigFileShape,
	RuntimeProjectConfigFileShape,
} from "./runtime-config-types";

/** The code-embedding settings fields of the resolved runtime config (defaults + override + effective). */
export type RuntimeEmbeddingConfigFields = Pick<
	RuntimeConfigState,
	"codeEmbeddingDefaults" | "codeEmbeddingOverride" | "effectiveCodeEmbeddingSettings"
>;

/**
 * Resolve the code-embedding settings block from the global + project configs, with the
 * `effective = override ?? default` derivation. Extracted from the toRuntimeConfigState builder
 * (§5.U) as a focused, independently tested override-pattern sub-resolver.
 */
/** Derive the code-embedding fields from raw default + override values (shared by the resolver and the flat-values builder). */
export function deriveEmbeddingFields(
	defaultsValue: Parameters<typeof normalizeCodeEmbeddingSettings>[0],
	overrideValue: Parameters<typeof normalizeCodeEmbeddingOverride>[0],
): RuntimeEmbeddingConfigFields {
	const codeEmbeddingDefaults = normalizeCodeEmbeddingSettings(defaultsValue, DEFAULT_CODE_EMBEDDING_SETTINGS);
	const codeEmbeddingOverride = normalizeCodeEmbeddingOverride(overrideValue);
	return {
		codeEmbeddingDefaults,
		codeEmbeddingOverride,
		effectiveCodeEmbeddingSettings: codeEmbeddingOverride ?? codeEmbeddingDefaults,
	};
}

export function resolveRuntimeEmbeddingConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
	projectConfig: RuntimeProjectConfigFileShape | null,
): RuntimeEmbeddingConfigFields {
	return deriveEmbeddingFields(globalConfig?.codeEmbeddingDefaults, projectConfig?.codeEmbeddingOverride);
}
