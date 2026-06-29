/**
 * Per-request inference speed+quality levers (todo §5.AQ item H) — the PURE decision core for the small-HW knobs that
 * make EVERY request fast AND correct AND complete AND high-quality, because compute is the bottleneck on small machines.
 *
 * The research (4 opus passes, see §5.AQ) ranks these by no-regret impact and gives one rule of thumb: the **no-regret
 * stack is caching → right-size context → flash-attention → Q8 KV**, and only THEN the opt-in/measured lever
 * (speculative decoding). Sampler choice is ~free. This module owns the three small, byte-pure decisions in that stack
 * that have a real "it depends" — everything else (healthy prefix caching = item D+E, right-sizing context = item G) is
 * either a layout guard or a load-knob and lives elsewhere:
 *
 *   - {@link shouldUseSpeculativeDecoding} — lever #4. Output is mathematically IDENTICAL to the target model (no quality
 *     loss BY CONSTRUCTION), 1.5-3× WHEN the draft accepts — but it commonly makes 8GB GPUs *slower* (up to 7×) and needs
 *     draft acceptance ≳0.5; SWA/hybrid + high temperature + tool-heavy traffic all tank acceptance. So it is OPT-IN and
 *     MEASURED: a high *measured* acceptance justifies it even on small VRAM; an *unknown* acceptance on ≤8GB is a gamble
 *     we decline; very short outputs never pay back the draft-setup overhead.
 *   - {@link recommendKvCacheQuant} — lever #3. Q8 K+V is the safe default *with* flash attention (−50% cache,
 *     perplexity Δ<0.1) — but WITHOUT flash attention quantized KV is actually *slower*, because it gets dequantized
 *     every decode step. So Q8 is gated strictly on flash attention being on.
 *   - {@link recommendSampler} — lever #5. Near-greedy (low temperature + tight top-p) for agent/tool work buys better
 *     tool-call reliability, reproducibility, AND higher speculative-decode acceptance, all for free; reasoning wants a
 *     little more room; creative wants the most.
 *
 * Pure + deterministic: no clock, no I/O, no config reads. These verdicts feed §5.AB model/flag selection and the load
 * knobs; the realized tok/s + TTFT + acceptance get recorded on the §5.AF ledger to close the loop with §5.AL.
 */

/** The default draft-acceptance bar below which speculative decoding is not worth it (research: needs ≳0.5). */
const DEFAULT_MIN_ACCEPTANCE_RATE = 0.5;

/** Below this many expected output tokens, the speculative-decode setup overhead dominates and never pays back. */
const MIN_OUTPUT_TOKENS_FOR_SPEC_DECODE = 20;

/** At or below this much GPU VRAM, speculative decoding commonly runs *slower* (up to 7×) unless acceptance is proven. */
const SMALL_VRAM_GB = 8;

/** A speculative-decoding verdict for one request: whether to enable it, plus the human-readable rationale. */
export interface SpecDecodeDecision {
	use: boolean;
	reason: string;
}

/**
 * Decide whether to enable speculative (draft-model) decoding for a request — lever #4 in §5.AQ-H.
 *
 * Speculative decoding is OUTPUT-IDENTICAL to the target model, so there is no quality risk; the only question is
 * whether it is FASTER. It commonly makes ≤8GB GPUs slower (up to 7×) and needs draft acceptance ≳0.5, so the policy is
 * opt-in + measured. First match wins:
 *
 *   1. Output too short (`expectedOutputTokens` < {@link MIN_OUTPUT_TOKENS_FOR_SPEC_DECODE}) → off: draft setup overhead
 *      dominates a tiny generation.
 *   2. Measured acceptance BELOW the threshold → off: the draft isn't landing often enough to pay for itself.
 *   3. Measured acceptance AT/ABOVE the threshold → on: a high *measured* acceptance justifies it even on small VRAM.
 *   4. Acceptance UNKNOWN and VRAM ≤ {@link SMALL_VRAM_GB} → off: commonly slower on small GPUs, don't gamble blind.
 *   5. Otherwise (unknown acceptance, ample/unknown VRAM, output long enough) → on as an acceptable default; measure
 *      acceptance to confirm.
 *
 * @param input.measuredAcceptanceRate Observed `accepted/(accepted+rejected)` draft-token rate in [0,1], or `null` when
 *   not yet measured.
 * @param input.expectedOutputTokens Rough expected generation length for this request.
 * @param input.gpuVramGb GPU VRAM in GB, or `null` when unknown (e.g. unified-memory Apple Silicon, or undetected).
 * @param input.minAcceptanceRate Optional override for the acceptance bar (defaults to {@link DEFAULT_MIN_ACCEPTANCE_RATE}).
 */
export function shouldUseSpeculativeDecoding(input: {
	measuredAcceptanceRate: number | null;
	expectedOutputTokens: number;
	gpuVramGb: number | null;
	minAcceptanceRate?: number;
}): SpecDecodeDecision {
	const threshold = input.minAcceptanceRate ?? DEFAULT_MIN_ACCEPTANCE_RATE;

	if (input.expectedOutputTokens < MIN_OUTPUT_TOKENS_FOR_SPEC_DECODE) {
		return { use: false, reason: "output too short — setup overhead dominates" };
	}

	if (input.measuredAcceptanceRate !== null) {
		if (input.measuredAcceptanceRate < threshold) {
			return { use: false, reason: "measured draft acceptance below threshold" };
		}
		return { use: true, reason: "measured acceptance clears the bar" };
	}

	if (input.gpuVramGb !== null && input.gpuVramGb <= SMALL_VRAM_GB) {
		return { use: false, reason: "unknown acceptance on <=8GB VRAM — commonly slower, don't gamble" };
	}

	return { use: true, reason: "acceptable default (measure acceptance to confirm)" };
}

/** KV-cache quantization recommendation: Q8 K+V, or no quantization. */
export type KvCacheQuant = "q8" | "none";

/**
 * Recommend a KV-cache quantization — lever #3 in §5.AQ-H.
 *
 * Q8 K+V is the safe default *with* flash attention: it halves the KV cache (→ longer context / bigger model) at a
 * perplexity delta < 0.1. But WITHOUT flash attention, quantized KV is actually SLOWER, because it must be dequantized
 * on every decode step — so we only ever recommend `"q8"` when flash attention is enabled, and `"none"` otherwise.
 */
export function recommendKvCacheQuant(input: { flashAttention: boolean }): KvCacheQuant {
	return input.flashAttention ? "q8" : "none";
}

/** A sampler profile: strict near-greedy for tool/code, a balanced middle, or a roomier creative setting. */
export type SamplerProfile = "tool_strict" | "balanced" | "creative";

/**
 * Recommend a sampler profile for a task kind — lever #5 in §5.AQ-H.
 *
 * Tool and code work want near-greedy sampling (low temperature + tight top-p): it improves tool-call reliability and
 * reproducibility AND raises speculative-decode acceptance, all for free. Reasoning wants a little more room
 * (`"balanced"`); open-ended creative work wants the most (`"creative"`).
 */
export function recommendSampler(taskKind: "tool" | "code" | "reasoning" | "creative"): SamplerProfile {
	switch (taskKind) {
		case "tool":
		case "code":
			return "tool_strict";
		case "reasoning":
			return "balanced";
		case "creative":
			return "creative";
	}
}
