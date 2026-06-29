/**
 * KV-cache VRAM sizing + right-size-the-context recommendation (todo §5.AQ item G) — the #1 resource-frugality lever on
 * small hardware. The KV cache grows LINEARLY in context length × layers (× kv-heads × head-dim × bytes-per-element), so
 * loading a model at its 128K maximum when a task only needs ~8K silently wastes on the order of ~15 GB of VRAM for
 * nothing. Right-sizing the loaded context is therefore the single biggest no-regret VRAM win — and it is part of the
 * same "no-regret stack" (caching → **right-size context** → flash-attention → Q8 KV) tracked alongside the per-request
 * levers in §5.AQ item H ({@link file://./inference-levers.ts}).
 *
 * Formula source. The decode-time KV cache stores one Key and one Value vector per token, per layer, per KV head:
 *
 *   bytes = contextLength · 2 · numLayers · numKvHeads · headDim · bytesPerParam
 *
 * The leading `2` is the K-plus-V pair. `numKvHeads` is the GROUPED-query-attention head count (often far smaller than
 * the attention-head count — e.g. Llama-3.1-8B has 8 KV heads feeding 32 query heads), which is exactly why the cache is
 * smaller than a naive per-attention-head estimate. `bytesPerParam` encodes the KV element width: 2 = FP16, 1 = Q8,
 * 0.5 = Q4 — so Q8 KV halves the cache and Q4 quarters it (the §5.AQ-H lever-#3 trade-off).
 *
 * Worked anchor (Llama-3.1-8B: numLayers 32, numKvHeads 8, headDim 128, FP16):
 *   - contextLength  4096 → 4096·2·32·8·128·2 =   536_870_912 bytes = 0.5 GiB
 *   - contextLength 32768 → 32768·2·32·8·128·2 = 4_294_967_296 bytes = 4   GiB
 * Halving to Q8 (bytesPerParam 1) halves both; the cache scales strictly with contextLength, which is the lever.
 *
 * Pure + deterministic: no clock, no I/O, no config reads — just arithmetic. The verdicts here feed the §5.AB load-knob
 * (what context to load a model at) and pair with the §5.AQ-H per-request levers.
 */

/** The fully-specified inputs to the KV-cache size formula. */
export interface KvCacheParams {
	/** Number of token positions the cache is sized for (the loaded/requested context window). */
	contextLength: number;
	/** Transformer layer count — each layer keeps its own K and V cache. */
	numLayers: number;
	/** Grouped-query-attention KV-head count (often << the attention-head count; e.g. 8 for Llama-3.1-8B). */
	numKvHeads: number;
	/** Per-head dimension of each Key/Value vector. */
	headDim: number;
	/** Bytes per stored KV element: 2 = FP16, 1 = Q8, 0.5 = Q4. */
	bytesPerParam: number;
}

/** Default context-rounding granularity: round recommended context up to the next multiple of this many tokens. */
const DEFAULT_ROUND_TO = 1024;

/** Default safety headroom added on top of the raw task-token estimate before rounding (25%). */
const DEFAULT_SAFETY_HEADROOM_FRACTION = 0.25;

/**
 * Exact KV-cache size in bytes for one fully-specified configuration — the formula
 * `contextLength · 2 · numLayers · numKvHeads · headDim · bytesPerParam` (the `2` is the K+V pair).
 *
 * Any non-positive field makes the result physically meaningless (a model has positive layers, heads and context), so
 * any field ≤ 0 short-circuits to `0` rather than returning a negative or zero-by-multiplication figure.
 */
export function kvCacheBytes(p: KvCacheParams): number {
	if (p.contextLength <= 0 || p.numLayers <= 0 || p.numKvHeads <= 0 || p.headDim <= 0 || p.bytesPerParam <= 0) {
		return 0;
	}
	return p.contextLength * 2 * p.numLayers * p.numKvHeads * p.headDim * p.bytesPerParam;
}

/**
 * Pick the SMALLEST context window that comfortably fits a task — the right-size-the-context lever (§5.AQ-G).
 *
 * The point is to never load a model at its maximum context when the task needs only a fraction of it: the KV cache is
 * linear in context length, so the unused tail is pure wasted VRAM. We take the task's raw token estimate, add a safety
 * headroom (default 25%) so we don't truncate mid-task, round UP to the next `roundTo` (default 1024) multiple so the
 * loaded window lands on a clean boundary, and finally clamp into `[roundTo, maxContextLength]`:
 *
 *   - a task that needs little still gets at least `roundTo` (never load a degenerate sub-`roundTo` window);
 *   - a task that needs more than the model can offer is capped at `maxContextLength` (we can't exceed the ceiling).
 *
 * @param input.taskNeededTokens Estimated tokens the task actually needs (prompt + working context + generation).
 * @param input.maxContextLength The model's maximum loadable context — the hard ceiling.
 * @param input.safetyHeadroomFraction Fractional padding over the raw estimate (defaults to 0.25 = +25%).
 * @param input.roundTo Rounding granularity and the floor of the result (defaults to 1024).
 */
export function recommendContextLength(input: {
	taskNeededTokens: number;
	maxContextLength: number;
	safetyHeadroomFraction?: number;
	roundTo?: number;
}): number {
	const roundTo = input.roundTo ?? DEFAULT_ROUND_TO;
	const headroom = input.safetyHeadroomFraction ?? DEFAULT_SAFETY_HEADROOM_FRACTION;

	if (roundTo <= 0) {
		return 0;
	}

	const needed = input.taskNeededTokens * (1 + headroom);
	const rounded = Math.ceil(needed / roundTo) * roundTo;
	const ceiling = Math.max(roundTo, input.maxContextLength);
	return Math.min(Math.max(rounded, roundTo), ceiling);
}

/**
 * VRAM saved (in bytes) by loading at `toContextLength` instead of `fromContextLength`, all else equal — the concrete
 * payoff of the §5.AQ-G right-sizing decision. Computed as `kvCacheBytes(at from) − kvCacheBytes(at to)`; since the
 * cache is monotonic in context length, shrinking the window saves bytes and growing it "saves" a negative amount, so a
 * non-positive difference is clamped to `0` (right-sizing never costs VRAM by this measure).
 */
export function kvCacheSavingsBytes(
	p: Omit<KvCacheParams, "contextLength">,
	fromContextLength: number,
	toContextLength: number,
): number {
	const from = kvCacheBytes({ ...p, contextLength: fromContextLength });
	const to = kvCacheBytes({ ...p, contextLength: toContextLength });
	return Math.max(0, from - to);
}
