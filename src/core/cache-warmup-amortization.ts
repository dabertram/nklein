/**
 * Prefix-cache warm-up AMORTIZATION / breakeven decision (todo §5.AQ — item H Tier 0 "healthy prefix caching … nothing
 * below matters if the cache is cold", and item E "reserve broken-cache models for short one-shot calls"). Prefix caching
 * is the single biggest local-inference speed lever, but it is not free to *establish*: the FIRST send of a big stable
 * prefix pays the full cold prefill (~200 s at 40k context) so that every LATER send is warm (~5 s). That one-time cost is
 * only worth paying if the prefix will be REUSED enough times to earn it back. This module owns that arithmetic — the
 * cost/benefit question the sibling cache cores each leave open.
 *
 * Why this is its own module (the gap none of the §5.AQ siblings fill): the existing cache cores reason about SPACE, byte
 * STRUCTURE, or WHETHER caching works — never the TIME cost of *building* a warm prefix vs how many reuses will repay it.
 *   - `cache-prefix-reuse.ts` PREDICTS how many TOKENS one next-turn assembly reuses vs re-prefills — a single-turn,
 *     token-unit measure. It never asks whether committing to the prefix pays back over MANY turns.
 *   - `cache-prefix-retention.ts` arbitrates a POOL of prefixes under a token BUDGET (which to evict) — a space-contention
 *     decision, in tokens. Its `shouldAdmitPrefix` asks "is this candidate worth a slot vs the incumbents?"; this module
 *     asks the orthogonal "is warming ANY prefix worth the one-time cold cost given the reuses ahead?" (a prefix can win a
 *     slot yet never be reused enough to amortize — and vice-versa).
 *   - `cache-health.ts` says IF the runtime reuses the prefix at all; a `healthy: false` model makes the warm saving ~0,
 *     which this module consumes (an unhealthy cache never amortizes — exactly item E's "reserve broken-cache models for
 *     one-shot calls"), but it does not compute the payback.
 *   - `inference-levers.ts` `shouldUseSpeculativeDecoding` is the ANALOGOUS opt-in cost/benefit gate for a DIFFERENT lever
 *     (draft models), not prefix warming.
 * So this module works in a distinct unit — TIME/COST over a horizon of REUSES — the way `cache-prefix-retention.ts`
 * deliberately works in tokens rather than the bytes `fast-memory-fit.ts` speaks. It composes nothing it must edit.
 *
 * The model is PURE + deterministic: no clock, no I/O, no model call. The cold-prefill cost, the warm per-turn cost, and
 * the expected reuse count are all INJECTED as plain numbers (a caller measures them via the `cache-health.ts` TTFT probe
 * / the §5.AF ledger and hands them here). "Cost" is any consistent non-negative unit — milliseconds, tok/s-derived
 * seconds, whatever — only the RATIO and the comparison to the horizon matter, so the unit is the caller's.
 *
 * The arithmetic. Warming a stable prefix and reusing it `n` times (n>0 subsequent warm sends after the initial cold one)
 * costs `cold + n·warm`. NOT warming it — paying the full (cold) prefill every send because nothing is held between
 * turns — costs `(1 + n)·cold` for the same `1 + n` sends. Warming wins when `cold + n·warm < (1 + n)·cold`, i.e. when
 * `n·warm < n·cold`, i.e. for any `n ≥ 1` whenever `warm < cold`. The interesting quantity is therefore not "does it ever
 * pay" (it does the moment there is ≥1 reuse and the cache is healthy) but "by HOW MUCH, and is the reuse horizon long
 * enough to bother": the per-reuse saving is `cold − warm`, and the number of reuses needed to repay the *extra* first-hit
 * cost relative to a chosen alternative is the {@link warmupBreakevenReuses}. See each function for the precise bar.
 */

/** Floor a possibly-messy cost / count to a non-negative finite number (a cost or a reuse count can't be below zero). */
function normalizeNonNegative(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return value;
}

/** Floor a possibly-messy reuse COUNT to a non-negative integer (you can't reuse a prefix a fractional number of times). */
function normalizeCount(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return Math.trunc(value);
}

/** The measured cost of the two prefill regimes for a prefix ({@link PrefixCostProfile}). */
export interface PrefixCostProfile {
	/**
	 * Cost to prefill the prefix COLD (the first, uncached send — full prefill of the whole stable prefix). Any consistent
	 * non-negative unit (ms, s, …); non-finite / negative is floored to 0. This is the one-time price of establishing the
	 * warm cache.
	 */
	coldPrefillCost: number;
	/**
	 * Cost to serve the same prefix WARM (a later send that reuses the prefix KV cache — near-instant prefill of the shared
	 * prefix). Same unit as {@link coldPrefillCost}; non-finite / negative is floored to 0. When the model's cache is
	 * unhealthy this equals (or approaches) {@link coldPrefillCost} — there is no warm regime, so warming never pays.
	 */
	warmPrefillCost: number;
}

/** The saving warming a prefix buys per reuse, and whether there is any saving to be had ({@link warmupSavingPerReuse}). */
export interface WarmupSaving {
	/** `coldPrefillCost − warmPrefillCost`, floored at 0 — the cost saved on EACH warm reuse vs paying cold again. */
	savingPerReuse: number;
	/**
	 * True when warming can save anything at all: the warm regime is strictly cheaper than the cold one AND the cache is
	 * healthy (a `false` cache health forces `savingPerReuse` to 0 — an unhealthy cache re-prefills every turn, so there is
	 * no warm regime to save into, no matter how cheap `warmPrefillCost` looks).
	 */
	canSave: boolean;
}

/**
 * The per-reuse saving of warming a prefix (pure). `savingPerReuse = max(0, coldPrefillCost − warmPrefillCost)` — the cost
 * avoided on each warm hit vs re-paying the cold prefill. `canSave` is true only when that saving is strictly positive AND
 * `cacheHealthy` is true: an unhealthy cache (SWA / SSM / broken format — see `cache-health.ts`) silently re-prefills
 * every turn, so warming buys nothing however small `warmPrefillCost` appears; forcing the saving to 0 there is what makes
 * "reserve broken-cache models for one-shot calls" (item E) fall out of the same arithmetic.
 *
 * @param profile The cold vs warm prefill costs of the prefix.
 * @param cacheHealthy Whether the runtime actually reuses this prefix (from a `cache-health.ts` verdict). Defaults to
 *   `true` — the caller is expected to gate on health; pass the real verdict to let an unhealthy cache zero the saving.
 */
export function warmupSavingPerReuse(profile: PrefixCostProfile, cacheHealthy = true): WarmupSaving {
	const cold = normalizeNonNegative(profile.coldPrefillCost);
	const warm = normalizeNonNegative(profile.warmPrefillCost);
	const rawSaving = cold - warm;
	const canSave = cacheHealthy && rawSaving > 0;
	return { savingPerReuse: canSave ? rawSaving : 0, canSave };
}

/**
 * The number of REUSES needed for warming a prefix to break even against an ALTERNATIVE per-send cost (pure). This is the
 * general breakeven: warming pays an EXTRA first-hit cost of `coldPrefillCost − alternativePerSendCost` up front (the cold
 * establish cost minus whatever the alternative would have paid on that same first send), and earns it back at
 * `alternativePerSendCost − warmPrefillCost` per subsequent reuse. The breakeven reuse count is the smallest integer `n`
 * for which the extra up-front cost is repaid:
 *
 *   `n_breakeven = ceil( (coldPrefillCost − alternativePerSendCost) / (alternativePerSendCost − warmPrefillCost) )`,
 *   clamped to ≥ 0.
 *
 * Two special cases fall out cleanly:
 *   - `alternativePerSendCost = coldPrefillCost` (the alternative is "pay cold every send" — i.e. don't hold the cache at
 *     all): the extra up-front cost is 0, so breakeven is 0 reuses (warming pays from the very first reuse — matching the
 *     `cold + n·warm < (1+n)·cold` derivation in the module header).
 *   - the warm regime is not strictly cheaper than the alternative (`alternativePerSendCost ≤ warmPrefillCost`), or the
 *     cache is unhealthy: warming can NEVER repay the up-front cost → {@link Number.POSITIVE_INFINITY} (never breaks even).
 *
 * @param profile The cold vs warm prefill costs of the prefix.
 * @param alternativePerSendCost The per-send cost of the alternative you'd otherwise pay (default: `coldPrefillCost`, i.e.
 *   compare against not caching at all). Non-finite / negative is floored to 0.
 * @param cacheHealthy Whether the runtime reuses the prefix (an unhealthy cache never breaks even). Default `true`.
 */
export function warmupBreakevenReuses(
	profile: PrefixCostProfile,
	alternativePerSendCost?: number,
	cacheHealthy = true,
): number {
	const cold = normalizeNonNegative(profile.coldPrefillCost);
	const warm = normalizeNonNegative(profile.warmPrefillCost);
	const alternative = alternativePerSendCost === undefined ? cold : normalizeNonNegative(alternativePerSendCost);

	const perReuseGain = alternative - warm;
	// No positive per-reuse gain (or an unhealthy cache) ⇒ the up-front cost is never repaid.
	if (!cacheHealthy || perReuseGain <= 0) {
		return Number.POSITIVE_INFINITY;
	}
	// Extra up-front cost of choosing to warm vs the alternative on the first send (never negative — a cheaper-than-alt
	// cold establish still "breaks even" at 0 reuses, it does not bank negative reuses).
	const extraUpFront = Math.max(0, cold - alternative);
	return Math.ceil(extraUpFront / perReuseGain);
}

/** The full amortization verdict for warming a prefix over an expected reuse horizon ({@link decideWarmupAmortization}). */
export interface WarmupAmortizationDecision {
	/** Whether warming (establishing + holding) this prefix is worth it for the expected reuse horizon. */
	worthWarming: boolean;
	/** The cost saved on each warm reuse ({@link warmupSavingPerReuse}); 0 when the cache can't save (unhealthy / no gain). */
	savingPerReuse: number;
	/**
	 * The reuse count at which warming breaks even against the alternative ({@link warmupBreakevenReuses});
	 * {@link Number.POSITIVE_INFINITY} when it never can. Compare `expectedReuses` against this.
	 */
	breakevenReuses: number;
	/**
	 * NET cost saved (can be negative) over the whole `1 + expectedReuses`-send horizon by warming instead of paying the
	 * ALTERNATIVE on every send: `expectedReuses · (alternativePerSendCost − warmPrefillCost) − extraUpFrontCost`, where
	 * `extraUpFrontCost = max(0, coldPrefillCost − alternativePerSendCost)`. (Equivalently: the alternative's total
	 * `alternativePerSendCost · (1 + expectedReuses)` minus warming's total `coldPrefillCost + expectedReuses ·
	 * warmPrefillCost`.) The per-reuse term is measured against the ALTERNATIVE, not {@link savingPerReuse} (which is the
	 * cold-vs-cold saving) — the two coincide only when the alternative IS the cold cost (the default). Positive ⇒ warming
	 * came out ahead across the horizon; the magnitude (in the caller's cost unit) RANKS which prefixes most deserve a
	 * scarce warm slot.
	 */
	netSaving: number;
	/** Inspectable one-line rationale (for logs / the cache-health panel / debugging). */
	reason: string;
}

/**
 * Decide whether warming (and holding) a prefix AMORTIZES over its expected reuse horizon (pure) — the item H Tier 0
 * "healthy prefix caching" gate, quantified. Warming is worth it when the cache can save at all AND the expected number of
 * reuses reaches the breakeven count; the verdict also reports the per-reuse saving, the breakeven, and the NET saving
 * across the horizon (which a caller can use to rank prefixes competing for a scarce warm slot — pairing naturally with
 * `cache-prefix-retention.ts`, which decides the space contention this decides the time value of).
 *
 * `expectedReuses` is the number of SUBSEQUENT warm sends anticipated after the initial cold establish (a strict one-shot
 * call is `0` reuses → never worth warming, item E). It is floored to a non-negative integer. `alternativePerSendCost`
 * defaults to the cold cost (compare against not caching at all): with that default any horizon of ≥1 reuse on a healthy
 * cache with a positive saving is worth warming (breakeven 0), which is the common case; pass a cheaper alternative (e.g.
 * the cost of routing to a smaller model that needs no big prefix) to demand more reuses before warming pays.
 *
 * @param input.profile The cold vs warm prefill costs of the prefix.
 * @param input.expectedReuses Anticipated subsequent warm reuses after the cold establish (0 = one-shot). Floored to ≥0 int.
 * @param input.alternativePerSendCost Per-send cost of the alternative (default: cold cost — i.e. don't cache at all).
 * @param input.cacheHealthy Whether the runtime reuses the prefix (from `cache-health.ts`). Default `true`.
 */
export function decideWarmupAmortization(input: {
	profile: PrefixCostProfile;
	expectedReuses: number;
	alternativePerSendCost?: number;
	cacheHealthy?: boolean;
}): WarmupAmortizationDecision {
	const cacheHealthy = input.cacheHealthy ?? true;
	const expectedReuses = normalizeCount(input.expectedReuses);
	const { savingPerReuse, canSave } = warmupSavingPerReuse(input.profile, cacheHealthy);
	const breakevenReuses = warmupBreakevenReuses(input.profile, input.alternativePerSendCost, cacheHealthy);

	const cold = normalizeNonNegative(input.profile.coldPrefillCost);
	const warm = normalizeNonNegative(input.profile.warmPrefillCost);
	const alternative =
		input.alternativePerSendCost === undefined ? cold : normalizeNonNegative(input.alternativePerSendCost);
	const extraUpFront = Math.max(0, cold - alternative);
	// Per-reuse gain is measured against the ALTERNATIVE (alt − warm), which equals savingPerReuse only when alt === cold.
	// When the cache can't save, warming pays no warm sends but still incurs any extra up-front cost vs the alternative.
	// The trailing `+ 0` normalizes a `-0` result (e.g. `-extraUpFront` when extraUpFront is 0) to a plain `0`.
	const netSaving = (canSave ? expectedReuses * (alternative - warm) - extraUpFront : -extraUpFront) + 0;

	// Worth warming iff there is a saving to be had AND the horizon reaches the (finite) breakeven count.
	const worthWarming = canSave && Number.isFinite(breakevenReuses) && expectedReuses >= breakevenReuses;

	const reason = !canSave
		? cacheHealthy
			? "warm not cheaper than cold — nothing to amortize"
			: "cache unhealthy (prefix re-prefills every turn) — warming never pays; reserve for one-shot calls"
		: worthWarming
			? `worth warming — ${expectedReuses} reuse(s) >= breakeven ${breakevenReuses}; net saving ${netSaving}`
			: `not worth warming — ${expectedReuses} reuse(s) < breakeven ${breakevenReuses}`;

	return { worthWarming, savingPerReuse, breakevenReuses, netSaving, reason };
}
