/**
 * Model-stats tracking level (§5.AN, David 2026-07-04) — PURE decision core.
 *
 * Per-request model usage (prompt/completion/total/reasoning tokens) is recorded on EVERY attempt into the agent
 * ledger (see `nklein-task-session-service` → `buildAttemptEvent` → `summarizeModelSpeed` → `dev model-speed`). David's
 * decision: keep tracking ALWAYS, at FULL detail by DEFAULT, but expose a config knob to REDUCE the captured detail to
 * a couple of levels. This module is that knob's vocabulary + the pure reduction it applies to a usage record.
 *
 *  - `full`  — capture everything, including the reasoning-token breakdown (today's behavior).
 *  - `basic` — capture the token TOTALS (prompt/completion/total) but drop the granular reasoning breakdown.
 *  - `off`   — capture no token stats at all (all usage fields null). The attempt's OUTCOME is still recorded — only
 *              the token telemetry is suppressed — so the ledger's success/failure signal is never lost.
 *
 * Pure + total + deterministic: no I/O, no clock, never mutates its input.
 */

export type ModelStatsTrackingLevel = "full" | "basic" | "off";

export const DEFAULT_MODEL_STATS_TRACKING_LEVEL: ModelStatsTrackingLevel = "full";

/** A per-request token-usage record. Any field may be null when the backend didn't report it. */
export interface ModelUsageStats {
	promptTokens: number | null;
	completionTokens: number | null;
	totalTokens: number | null;
	reasoningTokens: number | null;
}

const EMPTY_USAGE: ModelUsageStats = {
	promptTokens: null,
	completionTokens: null,
	totalTokens: null,
	reasoningTokens: null,
};

/** Coerce an arbitrary config value to a valid level; unknown / non-string ⇒ the default (`full`). */
export function normalizeModelStatsTrackingLevel(value: unknown): ModelStatsTrackingLevel {
	if (value === "full" || value === "basic" || value === "off") {
		return value;
	}
	return DEFAULT_MODEL_STATS_TRACKING_LEVEL;
}

/**
 * Reduce a full per-request usage record to what the configured tracking level captures. Returns a NEW object (never
 * mutates `stats`). `full` passes it through; `basic` nulls the reasoning breakdown; `off` nulls every token field.
 */
export function applyModelStatsTrackingLevel(level: ModelStatsTrackingLevel, stats: ModelUsageStats): ModelUsageStats {
	switch (level) {
		case "off":
			return { ...EMPTY_USAGE };
		case "basic":
			return {
				promptTokens: stats.promptTokens,
				completionTokens: stats.completionTokens,
				totalTokens: stats.totalTokens,
				reasoningTokens: null,
			};
		case "full":
			return {
				promptTokens: stats.promptTokens,
				completionTokens: stats.completionTokens,
				totalTokens: stats.totalTokens,
				reasoningTokens: stats.reasoningTokens,
			};
	}
}
