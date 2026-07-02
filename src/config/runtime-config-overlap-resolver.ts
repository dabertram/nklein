import type { RuntimeFileOverlapParallelism } from "../core/api-contract";
import type {
	RuntimeConfigState,
	RuntimeGlobalConfigFileShape,
	RuntimeProjectConfigFileShape,
} from "./runtime-config-types";

/**
 * §5.AK file-overlap parallelization — ALLOW BY DEFAULT since Phase B: the user's default-allow decision is
 * backed by the `::merge` conflict-resolution agent at the delivery seam (a conflict now gets one bounded
 * resolution session before the abort-and-surface fail-safe). The field is opt-OUT: only an explicit
 * `"serialize"` restores the old defer-on-overlap behavior.
 */
export const DEFAULT_FILE_OVERLAP_PARALLELISM: RuntimeFileOverlapParallelism = "allow";

/** Opt-out normalizer: only the literal string `"serialize"` defers overlapping starts — absent/garbage resolve to the default (`"allow"`). */
export function normalizeFileOverlapParallelism(value: unknown): RuntimeFileOverlapParallelism {
	return value === "serialize" ? "serialize" : DEFAULT_FILE_OVERLAP_PARALLELISM;
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
 * `effective = override ?? global` derivation (the skill-dynamics override pattern). The field is opt-OUT
 * since Phase B (merge agent landed): only the literal string `"serialize"` defers overlapping starts —
 * anything else (absent, garbage, old configs) resolves to `"allow"`.
 */
export function resolveRuntimeFileOverlapConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
	projectConfig: RuntimeProjectConfigFileShape | null,
): RuntimeFileOverlapConfigFields {
	return deriveFileOverlapFields(globalConfig?.fileOverlapParallelism, projectConfig?.fileOverlapParallelismOverride);
}
