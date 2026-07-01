/**
 * Fast-memory spillover-cliff guard (todo §5.AQ item G — "avoid the spillover cliff"). On the small machines !Klein
 * targets, model weights AND the KV cache must both live in FAST memory (GPU VRAM, or the fast tier of Apple unified
 * RAM). The moment the combined footprint spills past that budget the runtime pages weights/cache in and out of slow
 * memory and throughput collapses MULTI-fold (not a graceful slowdown — a cliff). The §5.AQ mandate: this belongs in the
 * load-headroom decision.
 *
 * The existing headroom guard ({@link file://./model-load-headroom.ts} `decideModelLoad`) only weighs model WEIGHTS
 * against a RAM reserve — it is blind to the KV cache, which is exactly the term that grows with context length and pushes
 * a load over the cliff (a 128K window can add ~15 GB the weights-only check never sees; §5.AQ item G). This module fills
 * that gap: it sums **weights + KV-cache-at-context + a fixed activation/runtime overhead** and checks the total against a
 * fast-memory BUDGET — a fraction of the physical fast memory (default 0.75, the todo's "keep peak < ~75% of unified RAM"
 * Apple-unified ceiling), leaving the rest for the OS + activation spikes so the box never hits the WIRED-memory panic
 * that is worse than an ordinary OOM.
 *
 * It composes {@link file://./kv-cache-size.ts} `kvCacheBytes` for the KV term, so the SAME formula backs both the
 * right-size-the-context lever (§5.AQ-G) and this fit check. Pure + deterministic: arithmetic only, no clock, no I/O, no
 * config reads. Its verdict feeds the effectful load path (alongside `decideModelLoad`) and the §5.AB routing; the caller
 * supplies live weights/KV geometry + the host's fast-memory size.
 */

import { type KvCacheParams, kvCacheBytes } from "./kv-cache-size";

const GiB = 1024 ** 3;
const gib = (bytes: number): string => `${(bytes / GiB).toFixed(1)} GiB`;

/**
 * Default share of physical fast memory a load may occupy before we call it a spill risk. 0.75 mirrors the todo §5.AQ-G
 * Apple-unified guidance ("keep peak < ~75% of unified RAM"): the remaining ~25% is left for the OS, other processes, and
 * transient activation spikes, so a healthy load never tips into WIRED-memory paging.
 */
export const DEFAULT_FAST_MEMORY_FRACTION = 0.75;

/**
 * Default fixed overhead (bytes) added on top of weights + KV cache for compute buffers / activations / runtime that are
 * NOT captured by the two big linear terms. ~1 GiB is a deliberately conservative flat allowance so the estimate errs on
 * the safe side of the cliff rather than optimistically under-counting.
 */
export const DEFAULT_OVERHEAD_BYTES = 1 * GiB;

/** The three fast-memory terms of a load, in bytes, plus their sum — the concrete footprint a fit check weighs. */
export interface FastMemoryFootprint {
	/** Model weights resident in fast memory (on-disk / loaded size in bytes). */
	weightsBytes: number;
	/** KV cache at the loaded context length (from {@link kvCacheBytes}). */
	kvCacheBytes: number;
	/** Fixed activation / compute-buffer / runtime overhead not covered by the two linear terms. */
	overheadBytes: number;
	/** `weightsBytes + kvCacheBytes + overheadBytes`. */
	totalBytes: number;
}

/**
 * Sum the fast-memory footprint of a load: weights + KV-cache-at-context + a fixed overhead. The KV term is computed from
 * the full {@link KvCacheParams} geometry via {@link kvCacheBytes} (so context length, layers, GQA kv-heads, head-dim and
 * the KV element width all flow through — e.g. Q8 KV halves this term). Any non-finite / negative input term is treated
 * as `0` for the sum so a single bad field can't produce a negative footprint; `overheadBytes` defaults to
 * {@link DEFAULT_OVERHEAD_BYTES}.
 *
 * @param input.weightsBytes Model weights resident in fast memory, in bytes.
 * @param input.kvCache The KV-cache geometry at the loaded context (fed to {@link kvCacheBytes}).
 * @param input.overheadBytes Fixed activation/runtime overhead (defaults to {@link DEFAULT_OVERHEAD_BYTES}).
 */
export function computeFastMemoryFootprint(input: {
	weightsBytes: number;
	kvCache: KvCacheParams;
	overheadBytes?: number;
}): FastMemoryFootprint {
	const weights = nonNegative(input.weightsBytes);
	const kv = nonNegative(kvCacheBytes(input.kvCache));
	const overhead = nonNegative(input.overheadBytes ?? DEFAULT_OVERHEAD_BYTES);
	return {
		weightsBytes: weights,
		kvCacheBytes: kv,
		overheadBytes: overhead,
		totalBytes: weights + kv + overhead,
	};
}

/** A spill-cliff verdict: whether the load fits under the fast-memory budget, plus the numbers and a human reason. */
export interface FastMemoryFitDecision {
	/** True only when the whole footprint fits under the fast-memory budget with margin. */
	fits: boolean;
	/** The load's total fast-memory footprint in bytes ({@link FastMemoryFootprint.totalBytes}). */
	footprintBytes: number;
	/** The usable fast-memory budget in bytes (`fastMemoryBytes × fastMemoryFraction`). */
	budgetBytes: number;
	/** Budget minus footprint — the remaining slack (negative when it spills). */
	marginBytes: number;
	/** Human-readable rationale for the verdict. */
	reason: string;
}

/**
 * Decide whether a load stays under the fast-memory cliff — the §5.AQ-G spillover guard.
 *
 * The footprint (weights + KV cache + overhead) must fit within a BUDGET of `fastMemoryBytes × fastMemoryFraction`
 * (default {@link DEFAULT_FAST_MEMORY_FRACTION}); the un-budgeted remainder is the OS/activation reserve that keeps the
 * box off the WIRED-memory paging cliff. Conservative by construction: a non-positive `fastMemoryBytes` (unknown fast
 * memory) or a non-positive footprint (nothing meaningful to place) both REFUSE — we never claim a fit we can't prove.
 * When it spills, the reason names the overshoot so the caller can shrink the context (right-size, §5.AQ-G), pick a
 * smaller quant, or route to a smaller model.
 *
 * @param input.footprintBytes The load's total fast-memory footprint (from {@link computeFastMemoryFootprint}).
 * @param input.fastMemoryBytes Physical fast memory available (GPU VRAM, or the unified-RAM pool), in bytes.
 * @param input.fastMemoryFraction Share of fast memory a load may occupy (defaults to {@link DEFAULT_FAST_MEMORY_FRACTION}).
 */
export function decideFastMemoryFit(input: {
	footprintBytes: number;
	fastMemoryBytes: number;
	fastMemoryFraction?: number;
}): FastMemoryFitDecision {
	const fraction = clampFraction(input.fastMemoryFraction ?? DEFAULT_FAST_MEMORY_FRACTION);
	const budgetBytes = nonNegative(input.fastMemoryBytes) * fraction;
	const footprintBytes = nonNegative(input.footprintBytes);
	const marginBytes = budgetBytes - footprintBytes;
	const pct = Math.round(fraction * 100);

	if (!(input.fastMemoryBytes > 0)) {
		return {
			fits: false,
			footprintBytes,
			budgetBytes,
			marginBytes,
			reason: "Unknown fast memory — refusing to place the load (cannot prove it stays off the spill cliff).",
		};
	}
	if (!(footprintBytes > 0)) {
		return {
			fits: false,
			footprintBytes,
			budgetBytes,
			marginBytes,
			reason: "Zero/unknown footprint — nothing to place; refusing (cannot prove a fit).",
		};
	}
	if (marginBytes < 0) {
		return {
			fits: false,
			footprintBytes,
			budgetBytes,
			marginBytes,
			reason: `Load footprint ${gib(footprintBytes)} exceeds the ${pct}% fast-memory budget (${gib(
				budgetBytes,
			)}) by ${gib(-marginBytes)} — spill risk. Right-size the context, pick a smaller quant, or use a smaller model.`,
		};
	}
	return {
		fits: true,
		footprintBytes,
		budgetBytes,
		marginBytes,
		reason: `OK — footprint ${gib(footprintBytes)} fits within the ${pct}% fast-memory budget (${gib(
			budgetBytes,
		)}) with ${gib(marginBytes)} to spare.`,
	};
}

/**
 * One-shot spill-cliff check straight from load geometry: build the footprint ({@link computeFastMemoryFootprint}) and
 * weigh it against the fast-memory budget ({@link decideFastMemoryFit}). The convenience path for callers that hold the
 * weights + KV geometry + host fast-memory size and just want the verdict.
 */
export function assessFastMemoryFit(input: {
	weightsBytes: number;
	kvCache: KvCacheParams;
	fastMemoryBytes: number;
	overheadBytes?: number;
	fastMemoryFraction?: number;
}): FastMemoryFitDecision {
	const footprint = computeFastMemoryFootprint({
		weightsBytes: input.weightsBytes,
		kvCache: input.kvCache,
		overheadBytes: input.overheadBytes,
	});
	return decideFastMemoryFit({
		footprintBytes: footprint.totalBytes,
		fastMemoryBytes: input.fastMemoryBytes,
		fastMemoryFraction: input.fastMemoryFraction,
	});
}

/**
 * The LARGEST KV-cache budget (bytes) a load may spend without spilling — the fast-memory budget minus weights and
 * overhead. This is the bridge to the §5.AQ-G right-size-the-context lever: given the leftover KV budget, the caller can
 * back out the maximum safe context length instead of loading blindly and hitting the cliff. Returns `0` when weights +
 * overhead already meet or exceed the budget (no room for ANY KV cache — the load can't fit even at zero context).
 *
 * @param input.weightsBytes Model weights in fast memory, in bytes.
 * @param input.fastMemoryBytes Physical fast memory available, in bytes.
 * @param input.overheadBytes Fixed activation/runtime overhead (defaults to {@link DEFAULT_OVERHEAD_BYTES}).
 * @param input.fastMemoryFraction Share of fast memory a load may occupy (defaults to {@link DEFAULT_FAST_MEMORY_FRACTION}).
 */
export function kvCacheBudgetBytes(input: {
	weightsBytes: number;
	fastMemoryBytes: number;
	overheadBytes?: number;
	fastMemoryFraction?: number;
}): number {
	const fraction = clampFraction(input.fastMemoryFraction ?? DEFAULT_FAST_MEMORY_FRACTION);
	const budget = nonNegative(input.fastMemoryBytes) * fraction;
	const fixed = nonNegative(input.weightsBytes) + nonNegative(input.overheadBytes ?? DEFAULT_OVERHEAD_BYTES);
	return Math.max(0, budget - fixed);
}

/** Coerce a value to a finite non-negative number (NaN / negatives / -0 → 0). */
function nonNegative(value: number): number {
	return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Clamp a fraction into (0, 1]; a non-finite / non-positive fraction falls back to the default budget share. */
function clampFraction(fraction: number): number {
	if (!Number.isFinite(fraction) || fraction <= 0) {
		return DEFAULT_FAST_MEMORY_FRACTION;
	}
	return Math.min(1, fraction);
}
