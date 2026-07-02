import type { RuntimeConfigState, RuntimeGlobalConfigFileShape } from "./runtime-config-types";

/** §5.AW opportunistic speculative best-of-N — ON BY DEFAULT (user decision 2026-07-02: "opportunistic"; disabling is the explicit act). */
export const DEFAULT_SPECULATIVE_BEST_OF_N_ENABLED = true;
/** §5.AW ceiling on concurrently running speculative candidates — conservative single-spec default. */
export const DEFAULT_SPECULATIVE_MAX_CONCURRENT_SPECS = 1;
/** §5.AW hard cap on the concurrent-spec ceiling — larger configured values are clamped down to this. */
export const SPECULATIVE_MAX_CONCURRENT_SPECS_CAP = 4;
/** §5.AW ceiling on speculative candidates per run — keeps the extra burn bounded per card. */
export const DEFAULT_SPECULATIVE_MAX_SPECS_PER_RUN = 3;
/** §5.AW hard cap on the per-run ceiling — larger configured values are clamped down to this. */
export const SPECULATIVE_MAX_SPECS_PER_RUN_CAP = 20;

/**
 * Default-ON gate normalizer: only a literal boolean `false` disables speculative best-of-N — any other
 * value is `true`. This is the OPPOSITE polarity of the retrieval fail-closed egress gate on purpose:
 * the user opted in by default (2026-07-02 "opportunistic"), so disabling is the explicit act and an
 * absent or mangled value must not silently turn the feature off.
 */
export function normalizeSpeculativeBestOfNEnabled(value: unknown): boolean {
	return value !== false;
}

/** Positive-integer ceiling normalizer: integers >= 1 pass (clamped to `cap`); anything else → `defaultValue`. */
function normalizePositiveIntegerCeiling(value: unknown, defaultValue: number, cap: number): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		return defaultValue;
	}
	return Math.min(value, cap);
}

/** Normalize the concurrent-spec ceiling: positive integer clamped to the cap; anything else → default. */
export function normalizeSpeculativeMaxConcurrentSpecs(value: unknown): number {
	return normalizePositiveIntegerCeiling(
		value,
		DEFAULT_SPECULATIVE_MAX_CONCURRENT_SPECS,
		SPECULATIVE_MAX_CONCURRENT_SPECS_CAP,
	);
}

/**
 * Normalize the per-run spec ceiling: positive integer clamped to the cap; anything else → default.
 * There is no "0 = off" — disabling speculative best-of-N is the boolean's job.
 */
export function normalizeSpeculativeMaxSpecsPerRun(value: unknown): number {
	return normalizePositiveIntegerCeiling(
		value,
		DEFAULT_SPECULATIVE_MAX_SPECS_PER_RUN,
		SPECULATIVE_MAX_SPECS_PER_RUN_CAP,
	);
}

/** The opportunistic speculative best-of-N (§5.AW) fields of the resolved runtime config. */
export type RuntimeSpeculativeConfigFields = Pick<
	RuntimeConfigState,
	"speculativeBestOfNEnabled" | "speculativeMaxConcurrentSpecs" | "speculativeMaxSpecsPerRun"
>;

/**
 * Resolve the opportunistic speculative best-of-N config block (§5.AW, user decision 2026-07-02) from a
 * stored global config, each field falling back to its default. Mirrors the retrieval sub-resolver
 * (§5.AC pattern) so the big config-state assembly reads as a set of focused, independently-tested
 * sub-resolvers. When enabled, idle capacity may mirror the hardest running card with extra speculative
 * candidates; the two integer ceilings make that extra burn visible and tunable. Unlike the fail-closed
 * retrieval egress gate this block is default-ON: only a literal `false` disables it (the user opted in
 * by default; disabling is the explicit act).
 */
export function resolveRuntimeSpeculativeConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
): RuntimeSpeculativeConfigFields {
	return {
		speculativeBestOfNEnabled: normalizeSpeculativeBestOfNEnabled(globalConfig?.speculativeBestOfNEnabled),
		speculativeMaxConcurrentSpecs: normalizeSpeculativeMaxConcurrentSpecs(
			globalConfig?.speculativeMaxConcurrentSpecs,
		),
		speculativeMaxSpecsPerRun: normalizeSpeculativeMaxSpecsPerRun(globalConfig?.speculativeMaxSpecsPerRun),
	};
}
