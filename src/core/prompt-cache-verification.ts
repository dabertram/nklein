/**
 * P19.4 — verify prompt caching EMPIRICALLY, per runtime build. PURE core.
 *
 * llama.cpp issue #15082 is an **unresolved regression** in which `--cache-reuse` stopped caching prefixes:
 * identical first ~1000 characters were fully reprocessed, bisected to a first-bad commit, and an attempted fix
 * did not resolve it. The operational lesson is blunt: **a flag being set is not evidence that the feature
 * works.** A build can accept the flag, report no error, and cache nothing.
 *
 * That matters more here than in most projects. Prefill is the dominant cost on consumer hardware — 24–36×
 * slower than generation on Apple Silicon — so silently-absent caching does not break anything, it just makes
 * every turn several times more expensive, indefinitely, while the configuration looks correct.
 *
 * ── THE MEASUREMENT: THE SAME PREFIX, TWICE ──
 * Send an identical prefix twice and compare prefill time. Working cache → the second is dramatically cheaper.
 * No cache → the two are within noise of each other. The runtime reports what is needed in its own logs
 * (`prompt eval time = … ms / N tokens`), so this needs no instrumentation of the model server.
 *
 * ── `indeterminate` IS THE COMMON ANSWER, AND IT IS NOT A PASS ──
 * Missing timings, a zero-token prompt, or a prefix too short to be cacheable all yield "we could not tell".
 * Reporting any of those as "caching works" would recreate exactly the #15082 failure: a system that believes it
 * is caching because nothing contradicted it. Absence of a contradiction is not evidence, and this module refuses
 * to treat it as one.
 *
 * Thresholds here are OPERATIONAL DEFAULTS in P18.5's sense — nobody has measured the right cutoff for this
 * workload, and they are labelled rather than presented as findings.
 */

export type CacheVerdict = "working" | "not_working" | "indeterminate";

export interface PromptEvalTiming {
	readonly milliseconds: number;
	readonly tokens: number;
}

/**
 * Parse llama.cpp's `prompt eval time = 1234.56 ms / 789 tokens (...)` line.
 *
 * Returns null on anything unrecognised rather than a zero-filled record: a parse failure and a genuinely zero
 * timing must not look alike, because the first is a harness problem and the second is a finding.
 */
export function parsePromptEvalTiming(line: string): PromptEvalTiming | null {
	const match = /prompt eval time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*tokens?/i.exec(line);
	if (!match?.[1] || !match[2]) {
		return null;
	}
	const milliseconds = Number.parseFloat(match[1]);
	const tokens = Number.parseInt(match[2], 10);
	if (!Number.isFinite(milliseconds) || !Number.isFinite(tokens)) {
		return null;
	}
	return { milliseconds, tokens };
}

/**
 * Speed-up factor at or above which a warm prefill is taken as evidence of caching.
 *
 * OPERATIONAL DEFAULT (P18.5), not measured: 2× is comfortably outside run-to-run prefill noise while being far
 * below what a working cache should deliver, so it errs toward calling a marginal case `indeterminate` rather
 * than claiming success.
 */
export const CACHE_SPEEDUP_BAR = 2;
/** Prefixes shorter than this are not reliably cacheable, so a null result proves nothing about the build. */
export const MIN_CACHEABLE_TOKENS = 256;

export interface CacheAssessment {
	readonly verdict: CacheVerdict;
	readonly speedup: number | null;
	readonly reason: string;
}

/**
 * Decide whether this runtime build is actually caching.
 *
 * The cold and warm runs must share a prefix; the caller is responsible for that, and for the prefix being long
 * enough to be worth caching. Both conditions are checked here rather than assumed, because a caller that got
 * either wrong would otherwise receive a confident verdict about nothing.
 */
export function assessCacheEffectiveness(input: {
	readonly cold: PromptEvalTiming | null;
	readonly warm: PromptEvalTiming | null;
	readonly speedupBar?: number;
}): CacheAssessment {
	const bar = input.speedupBar ?? CACHE_SPEEDUP_BAR;

	if (!input.cold || !input.warm) {
		return {
			verdict: "indeterminate",
			speedup: null,
			reason:
				"a prefill timing is missing — the runtime did not report it, or it was not parsed. That is a HARNESS gap, and reporting it as 'caching works' is exactly the #15082 failure: believing the cache works because nothing contradicted it",
		};
	}
	if (input.cold.tokens < MIN_CACHEABLE_TOKENS) {
		return {
			verdict: "indeterminate",
			speedup: null,
			reason: `the prefix is only ${input.cold.tokens} token(s), below the ~${MIN_CACHEABLE_TOKENS} where caching is reliably worthwhile — a null result here says nothing about the build`,
		};
	}
	if (input.cold.milliseconds <= 0 || input.warm.milliseconds < 0) {
		return {
			verdict: "indeterminate",
			speedup: null,
			reason: "a non-positive prefill time cannot be compared — treat as a measurement fault, not a fast cache",
		};
	}
	if (input.cold.tokens !== input.warm.tokens) {
		return {
			verdict: "indeterminate",
			speedup: null,
			reason: `cold and warm prefills covered different token counts (${input.cold.tokens} vs ${input.warm.tokens}) — they did not share a prefix, so any speed-up measures the prompts, not the cache`,
		};
	}

	// A warm prefill of zero is the strongest possible cache hit, not a division problem.
	const speedup =
		input.warm.milliseconds === 0 ? Number.POSITIVE_INFINITY : input.cold.milliseconds / input.warm.milliseconds;

	if (speedup >= bar) {
		return {
			verdict: "working",
			speedup,
			reason: `warm prefill was ${Number.isFinite(speedup) ? `${speedup.toFixed(1)}×` : "immeasurably"} faster over ${input.cold.tokens} identical token(s) — the build is reusing the prefix`,
		};
	}

	return {
		verdict: "not_working",
		speedup,
		reason: `warm prefill was only ${speedup.toFixed(2)}× faster over ${input.cold.tokens} identical token(s) — within noise of a full reprocess. THE FLAG BEING SET IS NOT EVIDENCE (llama.cpp #15082: a build can accept --cache-reuse and cache nothing). Prefill is 24–36× generation cost on Apple Silicon, so this is expensive and silent`,
	};
}
