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
export function resolveRuntimeEmbeddingConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
	projectConfig: RuntimeProjectConfigFileShape | null,
): RuntimeEmbeddingConfigFields {
	const codeEmbeddingDefaults = normalizeCodeEmbeddingSettings(
		globalConfig?.codeEmbeddingDefaults,
		DEFAULT_CODE_EMBEDDING_SETTINGS,
	);
	const codeEmbeddingOverride = normalizeCodeEmbeddingOverride(projectConfig?.codeEmbeddingOverride);
	return {
		codeEmbeddingDefaults,
		codeEmbeddingOverride,
		effectiveCodeEmbeddingSettings: codeEmbeddingOverride ?? codeEmbeddingDefaults,
	};
}
