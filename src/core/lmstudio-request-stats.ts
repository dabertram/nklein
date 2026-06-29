/**
 * §5.AN: parse LM Studio's per-request inference `stats` from its native `/api/v0/chat/completions` response (pure).
 * Live-verified (2026-06-29): `/api/v0` returns `stats.tokens_per_second`, `stats.time_to_first_token` (seconds),
 * `stats.generation_time`, `stats.stop_reason` + `model_info.{arch,quant,context_length}` — REAL speed metrics straight
 * from the server, unlike the OpenAI `/v1` endpoint whose `stats` field comes back empty. Feeds §5.AB selection / §6.4
 * MCSR / the §4A stall detector with measured (not estimated) speed. Pure + defensive (missing fields ⇒ null).
 */

export interface LmStudioRequestStats {
	/** Decode throughput in tokens/second (`stats.tokens_per_second`). */
	tokensPerSecond: number | null;
	/** Time to first token in MILLISECONDS (converted from `stats.time_to_first_token`, which is in seconds). */
	ttftMs: number | null;
	/** Total generation time in milliseconds (from `stats.generation_time` seconds). */
	generationTimeMs: number | null;
	/** The server's stop reason (`eosFound` / `maxTokensReached` / …). */
	stopReason: string | null;
	/** Model facts from `model_info` (`arch` / `quant` / `context_length`), when present. */
	arch: string | null;
	quant: string | null;
	contextLength: number | null;
}

function finiteOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function secondsToMs(value: unknown): number | null {
	const seconds = finiteOrNull(value);
	return seconds === null ? null : Math.round(seconds * 1000);
}

/**
 * Extract the per-request stats from an `/api/v0/chat/completions` JSON response (pure). Returns all-null fields when the
 * `stats`/`model_info` blocks are absent (e.g. the OpenAI `/v1` endpoint, which returns an empty `stats`), so callers can
 * detect "no real stats available" uniformly.
 */
export function parseLmStudioRequestStats(response: unknown): LmStudioRequestStats {
	const root = (response ?? {}) as { stats?: Record<string, unknown>; model_info?: Record<string, unknown> };
	const stats = root.stats ?? {};
	const modelInfo = root.model_info ?? {};
	return {
		tokensPerSecond: finiteOrNull(stats.tokens_per_second),
		ttftMs: secondsToMs(stats.time_to_first_token),
		generationTimeMs: secondsToMs(stats.generation_time),
		stopReason: typeof stats.stop_reason === "string" ? stats.stop_reason : null,
		arch: typeof modelInfo.arch === "string" ? modelInfo.arch : null,
		quant: typeof modelInfo.quant === "string" ? modelInfo.quant : null,
		contextLength: finiteOrNull(modelInfo.context_length),
	};
}

/** Render the stats as a one-line operator summary (for `nklein dev model-speed`). */
export function renderLmStudioRequestStats(modelId: string, stats: LmStudioRequestStats): string {
	const tps = stats.tokensPerSecond !== null ? `${stats.tokensPerSecond.toFixed(1)} tok/s` : "tok/s n/a";
	const ttft = stats.ttftMs !== null ? `${stats.ttftMs}ms ttft` : "ttft n/a";
	const info = [stats.arch, stats.quant, stats.contextLength ? `ctx ${stats.contextLength}` : null]
		.filter((part): part is string => Boolean(part))
		.join(" · ");
	return `${modelId}  ${tps} · ${ttft}${stats.stopReason ? ` · ${stats.stopReason}` : ""}${info ? `  [${info}]` : ""}`;
}
