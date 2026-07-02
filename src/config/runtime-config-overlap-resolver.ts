import type { RuntimeFileOverlapParallelism } from "../core/api-contract";
import type {
	RuntimeConfigState,
	RuntimeGlobalConfigFileShape,
	RuntimeProjectConfigFileShape,
} from "./runtime-config-types";

/** §5.AK file-overlap parallelization — SERIALIZE BY DEFAULT (today's defer-on-overlap; Phase B flips to "allow" once the merge agent lands). */
export const DEFAULT_FILE_OVERLAP_PARALLELISM: RuntimeFileOverlapParallelism = "serialize";

/** Fail-safe normalizer: only the literal string `"allow"` enables overlap parallelism — any other value serializes. */
export function normalizeFileOverlapParallelism(value: unknown): RuntimeFileOverlapParallelism {
	return value === "allow" ? "allow" : DEFAULT_FILE_OVERLAP_PARALLELISM;
}

/** Sparse per-project override: `"allow"`/`"serialize"` pass through, anything else → null (= use the global value). */
export function normalizeFileOverlapParallelismOverride(value: unknown): RuntimeFileOverlapParallelism | null {
	return value === "allow" || value === "serialize" ? value : null;
}

/** The file-overlap parallelism fields of the resolved runtime config (global + override + effective). */
export type RuntimeFileOverlapConfigFields = Pick<
	RuntimeConfigState,
	"fileOverlapParallelism" | "fileOverlapParallelismOverride" | "effectiveFileOverlapParallelism"
>;

/** Derive the file-overlap fields from raw global + override values (shared by the resolver and the flat-values builder). */
export function deriveFileOverlapFields(defaultValue: unknown, overrideValue: unknown): RuntimeFileOverlapConfigFields {
	const fileOverlapParallelism = normalizeFileOverlapParallelism(defaultValue);
	const fileOverlapParallelismOverride = normalizeFileOverlapParallelismOverride(overrideValue);
	return {
		fileOverlapParallelism,
		fileOverlapParallelismOverride,
		effectiveFileOverlapParallelism: fileOverlapParallelismOverride ?? fileOverlapParallelism,
	};
}

/**
 * Resolve the file-overlap parallelism block (§5.AK) from the global + project configs, with the
 * `effective = override ?? global` derivation (the skill-dynamics override pattern). Fail-safe: only the
 * literal string `"allow"` enables parallel starts on overlapping files — anything else (absent, garbage,
 * old configs) resolves to `"serialize"`, today's defer-on-overlap behavior.
 */
export function resolveRuntimeFileOverlapConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
	projectConfig: RuntimeProjectConfigFileShape | null,
): RuntimeFileOverlapConfigFields {
	return deriveFileOverlapFields(globalConfig?.fileOverlapParallelism, projectConfig?.fileOverlapParallelismOverride);
}
