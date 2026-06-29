/**
 * Cache-HEALTH probe interpreter (todo §5.AQ item E) — the PURE math that decides whether a local runtime is actually
 * REUSING its prefix KV cache for a given `(engine, model, format, quant, ctx)`.
 *
 * Why this exists: prefix caching is the single biggest local-inference speed lever (item D's byte-stable prefix is
 * worthless if the engine silently ignores it — ~5s cached vs ~200s uncached at 40k context), and it **FAILS SILENTLY
 * and is engine/format-specific**. Prefix reuse only works on PURE full-attention models; **SWA / SSM-Mamba /
 * mixed-attention architectures silently fall back to a full recompute** (plain MoE is fine). The same model can cache
 * in one packaging and not another: LM Studio #1697 has MLX GPT-OSS-20B broken while the GGUF of the SAME model caches
 * fine; see also mlx-lm #980 (Qwen3.5 / GPT-OSS / Gemma3 / Llama4) and llama.cpp #20225/#19794/#21468 (Qwen3.5 /
 * Qwen3-Coder / Gemma4). Nothing surfaces this in the API response — so !Klein must DETECT cache health empirically and
 * ADAPT (route to the cache-friendly variant, or reserve a broken-cache model for short one-shot calls).
 *
 * This module is the pure INTERPRETER for the three detection signals (don't trust just one):
 *   - {@link classifyCacheHealth} — the **universal** TTFT double-prefix probe (works on every engine): send one fixed
 *     prefix twice, compare time-to-first-token. The most trustworthy signal because it observes the actual effect.
 *   - {@link interpretLlamaCppCacheTimings} — llama.cpp's `timings.prompt_n` / `cache_n` (tokens prefilled vs reused).
 *   - {@link cacheHealthFromCachedTokens} — an **ADVISORY-only** read of an OpenAI-style `cached_tokens` count (see its
 *     doc comment — LM Studio's `cached_tokens` is unreliable, #778).
 *
 * It is pure + deterministic: it never reads the clock and performs no I/O — callers run the probe / parse the runtime
 * response, then hand the raw numbers here for a verdict. The verdict caches next to the §5.AL model-capability catalog
 * as a new "cache-health" dimension and feeds §5.AB routing; re-probe only on an engine/model version change. The
 * byte-stable-prefix GUARD that makes caching POSSIBLE is the sibling `cache-aware-prompt-layout.ts` (item D); the
 * adaptation playbook + per-request TTFT watchdog (item E/H) consume these verdicts elsewhere.
 */

/** Verdict from the universal TTFT double-prefix probe ({@link classifyCacheHealth}). */
export interface CacheHealthVerdict {
	/** True when the warm (2nd) TTFT is enough faster than the cold (1st) — i.e. the prefix KV cache is being reused. */
	healthy: boolean;
	/** `coldTtftMs / warmTtftMs`. ≥ ~3–5 indicates a real cache hit; ~1 means the prefix was recomputed. `0` if unusable. */
	speedup: number;
	/** Human-readable explanation of the verdict (for logs / the cache-health panel). */
	reason: string;
}

/** Default minimum cold/warm TTFT ratio to call the cache healthy (the conservative end of the observed 3–5× range). */
const DEFAULT_MIN_SPEEDUP = 3;

/**
 * The universal cache-health PROBE interpreter: send a fixed ~4–8k-token prefix (plus a tiny suffix) to the model TWICE
 * and time the time-to-first-token each time. A reused prefix KV cache makes the 2nd (warm) prefill near-instant, so the
 * speedup `coldTtftMs / warmTtftMs` jumps to ~3–5×+; if the engine silently recomputed the prefix (SWA / hybrid / broken
 * format) the two TTFTs are roughly equal (speedup ~1) and the verdict is unhealthy.
 *
 * This is the most trustworthy of the three signals because it measures the actual EFFECT rather than a self-reported
 * counter — prefer it over {@link cacheHealthFromCachedTokens} (which LM Studio populates unreliably, #778). A `healthy`
 * verdict means the prefix KV cache is being reused; an unhealthy one means route to a cache-friendly variant or reserve
 * this model for short one-shot calls.
 *
 * Guards: any non-positive or non-finite timing (`cold <= 0`, `warm <= 0`, or `NaN`/`Infinity`) is unmeasurable — a
 * zero/negative warm TTFT would otherwise produce an infinite or negative "speedup" — so it returns
 * `{ healthy: false, speedup: 0, reason: "unusable timing" }` rather than a bogus number.
 *
 * @param input.coldTtftMs Time-to-first-token of the FIRST (cold) prefix send, in milliseconds.
 * @param input.warmTtftMs Time-to-first-token of the SECOND (warm) identical prefix send, in milliseconds.
 * @param input.minSpeedup Minimum `cold/warm` ratio to consider the cache healthy. Defaults to {@link DEFAULT_MIN_SPEEDUP}.
 */
export function classifyCacheHealth(input: {
	coldTtftMs: number;
	warmTtftMs: number;
	minSpeedup?: number;
}): CacheHealthVerdict {
	const { coldTtftMs, warmTtftMs } = input;
	const usable = Number.isFinite(coldTtftMs) && Number.isFinite(warmTtftMs) && coldTtftMs > 0 && warmTtftMs > 0;
	if (!usable) {
		return { healthy: false, speedup: 0, reason: "unusable timing" };
	}

	const minSpeedup = input.minSpeedup ?? DEFAULT_MIN_SPEEDUP;
	const speedup = coldTtftMs / warmTtftMs;
	const healthy = speedup >= minSpeedup;
	const reason = healthy
		? `warm TTFT ${speedup.toFixed(1)}x faster than cold (>= ${minSpeedup}x) — prefix KV cache is being reused`
		: `warm TTFT only ${speedup.toFixed(1)}x faster than cold (< ${minSpeedup}x) — prefix appears to be recomputed`;
	return { healthy, speedup, reason };
}

/** Verdict from parsing llama.cpp's prefill/reuse token counts ({@link interpretLlamaCppCacheTimings}). */
export interface CacheTimingsVerdict {
	/** Tokens served from the KV cache this turn (llama.cpp `cache_n`). */
	reusedTokens: number;
	/** Total prefix tokens this turn = freshly prefilled (`prompt_n`) + reused (`cache_n`). */
	totalPrefillTokens: number;
	/** `reusedTokens / totalPrefillTokens`, in `[0, 1]` (`0` when there were no prefix tokens at all). */
	hitRatio: number;
	/** True when at least half the prefix was reused — a stable prefix should reuse most of it after the first turn. */
	healthy: boolean;
}

/** Minimum reuse fraction to call a runtime's reported cache healthy (a stable prefix should reuse most of itself). */
const MIN_HIT_RATIO = 0.5;

/** Clamp negative reported counts to 0 (a runtime should never report a negative count, but never trust the input). */
function nonNegative(n: number): number {
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Interpret llama.cpp's per-request cache timings. llama.cpp (and its server) report `timings.prompt_n` = the tokens it
 * actually had to PREFILL this turn, and `cache_n` = the tokens it REUSED from the prefix KV cache (the server also logs
 * a "Cache reuse summary"). After the first turn a byte-stable prefix should reuse the bulk of the prompt, so a healthy
 * cache means the reused fraction dominates.
 *
 * `reusedTokens = cacheN`; `totalPrefillTokens = promptN + cacheN`; `hitRatio = totalPrefillTokens > 0 ? cacheN /
 * totalPrefillTokens : 0`; `healthy = hitRatio >= 0.5`. Negative reported counts are guarded to `0`.
 *
 * @param input.promptN llama.cpp `timings.prompt_n` — tokens freshly prefilled this turn.
 * @param input.cacheN  llama.cpp `cache_n` — tokens reused from the prefix KV cache this turn.
 */
export function interpretLlamaCppCacheTimings(input: { promptN: number; cacheN: number }): CacheTimingsVerdict {
	const promptN = nonNegative(input.promptN);
	const cacheN = nonNegative(input.cacheN);
	const totalPrefillTokens = promptN + cacheN;
	const hitRatio = totalPrefillTokens > 0 ? cacheN / totalPrefillTokens : 0;
	return {
		reusedTokens: cacheN,
		totalPrefillTokens,
		hitRatio,
		healthy: hitRatio >= MIN_HIT_RATIO,
	};
}

/** Clamp a value into the inclusive `[min, max]` range. */
function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/**
 * Compute a cache hit-ratio from an OpenAI-style `cached_tokens` count: `hitRatio = inputTokens > 0 ?
 * clamp(cachedTokens / inputTokens, 0, 1) : 0`; `healthy = hitRatio >= 0.5`.
 *
 * ⚠️ ADVISORY ONLY — DO NOT rely on this as the primary cache-health signal. **LM Studio's `cached_tokens` is
 * UNRELIABLE: it is frequently left UNPOPULATED (reported as 0) even when prefix caching IS working (bug #778)**, so a
 * `false`/low result here is NOT proof the cache is cold — it routinely under-reports. Treat a high ratio as weak
 * positive evidence and a low/zero ratio as INCONCLUSIVE; always prefer the TTFT double-prefix probe
 * ({@link classifyCacheHealth}), which observes the real effect, when deciding routing.
 *
 * @param input.inputTokens  Total prompt tokens for the request.
 * @param input.cachedTokens Tokens the provider claims were served from cache (OpenAI-style `cached_tokens`).
 */
export function cacheHealthFromCachedTokens(input: { inputTokens: number; cachedTokens: number }): {
	hitRatio: number;
	healthy: boolean;
} {
	const inputTokens = nonNegative(input.inputTokens);
	const cachedTokens = nonNegative(input.cachedTokens);
	const hitRatio = inputTokens > 0 ? clamp(cachedTokens / inputTokens, 0, 1) : 0;
	return { hitRatio, healthy: hitRatio >= MIN_HIT_RATIO };
}
