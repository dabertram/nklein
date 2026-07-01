/**
 * Prompt-cache PREFIX RETENTION / EVICTION policy (todo §5.AQ item E — the swarm "parallel slots EVICT each other's
 * cache" caveat, generalized). A local runtime holds a BOUNDED pool of prefix KV caches (llama.cpp slots; the shared MLX
 * / LM Studio cache budget). When more distinct prefixes are in play than the budget holds — the multi-session board, or
 * a swarm whose subagents each warm their own prefix — SOMETHING must be evicted, and evicting the wrong prefix throws
 * away the exact thing §5.AQ item D fought to build: a warm byte-stable prefix that turns a ~200 s cold prefill into
 * ~5 s. This module owns that choice: given the currently-cached prefixes (each = its token SIZE + last-use RECENCY +
 * observed HIT-RATE) and a token BUDGET, decide which to KEEP and which to EVICT, and whether a NEW prefix is even worth
 * admitting.
 *
 * Why this is its own module (and not any §5.AQ sibling): the existing cache cores each answer a DIFFERENT question over
 * a SINGLE prefix. `cache-prefix-reuse.ts` (item D) PREDICTS partial reuse for ONE next-turn assembly vs the previous one
 * (a single sequence pair — it does not know a second cached prefix exists). `cache-aware-prompt-layout.ts` (item D) is a
 * volatile-content LINT on one prefix. `cache-health.ts` (item E) INTERPRETS the runtime-reported counts for one request
 * AFTER the fact. `fast-memory-fit.ts` `kvCacheBudgetBytes` (item G) sizes ONE model's KV budget in bytes. None of them
 * arbitrates a POOL of competing prefixes under a shared budget — the "which of these N warm prefixes do I sacrifice"
 * decision. That is the missing lever this module supplies, in TOKENS (the budget unit `kvCacheBudgetBytes` /
 * `context-budget-knee.ts` already speak) rather than bytes.
 *
 * Policy: a cost-aware VALUE per prefix, in the GreedyDual-Size-Frequency / cost-aware-LRU family (the right family for a
 * cache whose entries have unequal SIZE and unequal reuse VALUE — a plain LRU that discards a large, frequently-hit
 * shared prefix to keep a tiny one-shot is exactly the swarm anti-pattern). Each prefix's value rewards a high hit-rate
 * (a prefix that is actually reused is worth warming), rewards RECENCY (a stale prefix is unlikely to be hit again), and
 * — because eviction frees the SPACE, not the entry — is measured PER TOKEN so a big cache must earn its footprint. We
 * KEEP prefixes by value DESCENDING until the budget is full, EVICT the rest; `pinned` prefixes (e.g. the main agent
 * session's stable prefix, item E's "pin a stable agent session to a fixed slot") are retained first and never evicted.
 *
 * Pure + deterministic: arithmetic + a sort, no clock and no I/O. RECENCY is injected as an already-computed age (the
 * caller reads the clock and subtracts) so this module never touches `Date.now`; token SIZES and hit-rates are injected
 * numbers. The verdict feeds the effectful cache/slot manager (which prefixes to drop before warming a new one) and the
 * §5.AF ledger (log the retained/evicted set + realized subsequent hit-rate).
 *
 * Boundary: this is the POOL-level retention axis only. It never reorders a prompt (that is §5.AD `context-smart-zone.ts`
 * for attention and item D's orderer for the prefix), never trims a prompt to a window (§5.AE `jit-fragment-budget.ts`),
 * and never decides a prefix's INTERNAL layout — it only ranks whole cached prefixes against a shared cache budget.
 */

/** One prefix currently (or prospectively) held in the runtime's prefix KV cache — the unit retention arbitrates over. */
export interface CachedPrefix {
	/** Stable identity of the cached prefix (e.g. a session/slot id or a prefix hash). Used only to report keep/evict. */
	id: string;
	/**
	 * Token SIZE of the cached prefix — the KV-cache footprint it occupies AND the space freed by evicting it. Non-finite
	 * / negative values are floored to 0. This is the cost side of the cost-aware value.
	 */
	tokenCount: number;
	/**
	 * How long since this prefix was last USED, in the caller's own time unit (ms, turns, whatever — only RELATIVE order
	 * matters). The caller computes it (reads the clock and subtracts) so this module stays clock-free. Larger ⇒ staler ⇒
	 * less likely to be hit again ⇒ lower value. Non-finite / negative values are floored to 0 (treated as just-used).
	 */
	ageSinceUse: number;
	/**
	 * Observed cache HIT-RATE for this prefix in `[0, 1]` — the fraction of recent turns that reused it (from
	 * `cache-health.ts` verdicts / ledger history). Higher ⇒ more valuable to keep warm. Values outside `[0, 1]` are
	 * clamped; a missing value defaults to {@link DEFAULT_HIT_RATE} (a neutral prior — not yet observed, don't over/under
	 * favor it).
	 */
	hitRate?: number;
	/**
	 * When true, this prefix is PINNED and is retained before any unpinned prefix and never evicted (e.g. the primary
	 * interactive session's stable prefix — item E: "pin a stable agent session to a fixed slot"). Pinned prefixes still
	 * consume budget and can push the total OVER it, which is reported (never hidden), not resolved by evicting a pin.
	 */
	pinned?: boolean;
}

/** A single prefix ranked by the retention policy, with its computed value exposed for logs / the cache panel. */
export interface RankedPrefix {
	/** The prefix's id (echoing {@link CachedPrefix.id}). */
	id: string;
	/** The prefix's (normalized) token footprint. */
	tokenCount: number;
	/**
	 * The cost-aware retention VALUE used to rank it (higher ⇒ kept first). Composed from hit-rate, recency, and per-token
	 * footprint (see {@link prefixRetentionValue}). Pinned prefixes carry {@link Number.POSITIVE_INFINITY} so they always
	 * sort first. Exposed for inspection; the ordering, not the absolute magnitude, is what matters.
	 */
	value: number;
}

/** The retention decision for a pool of cached prefixes under a token budget ({@link decidePrefixRetention}). */
export interface PrefixRetentionDecision {
	/** Ids to KEEP warm, in retention order (pinned first, then by value descending) — their total fits the budget. */
	keep: string[];
	/** Ids to EVICT to fit the budget, in the order they were sacrificed (lowest value first). */
	evict: string[];
	/** Total (normalized) token footprint of the `keep` set. */
	keptTokens: number;
	/** Whether `keptTokens` exceeds the budget — only ever true because the PINNED prefixes alone overran it. */
	overBudget: boolean;
	/** Inspectable one-line reason for the decision (for §5.AG surfaces / the cache-health panel / debugging). */
	reason: string;
}

/** Neutral hit-rate prior for a prefix with no observed history — don't unfairly favor or starve an un-probed prefix. */
export const DEFAULT_HIT_RATE = 0.5;

/**
 * Recency half-life (in the caller's `ageSinceUse` unit) for the recency weight. At `ageSinceUse === RECENCY_HALF_LIFE`
 * a prefix's recency factor is 0.5; it decays smoothly toward 0 as the prefix goes stale. A half-life (rather than a hard
 * cutoff) keeps the ranking stable under small age jitter. The unit is the caller's, so this is a shape constant, not a
 * wall-clock value; a caller with an unusual time unit can override it via {@link PrefixRetentionOptions.recencyHalfLife}.
 */
export const DEFAULT_RECENCY_HALF_LIFE = 60_000;

/** Options for {@link decidePrefixRetention} (and {@link shouldAdmitPrefix}). */
export interface PrefixRetentionOptions {
	/** Override the recency half-life used for the recency weight. Non-finite / non-positive falls back to the default. */
	recencyHalfLife?: number;
}

/** Floor a possibly-messy token count / age to a non-negative integer (a footprint / age can't be below zero). */
function normalizeNonNegative(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return Math.trunc(value);
}

/** Clamp a value into the inclusive `[min, max]` range. */
function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) {
		return min;
	}
	return Math.min(max, Math.max(min, value));
}

/** Resolve a usable positive recency half-life from the options (default when missing / invalid). */
function resolveHalfLife(options?: PrefixRetentionOptions): number {
	const raw = options?.recencyHalfLife;
	return Number.isFinite(raw) && (raw as number) > 0 ? (raw as number) : DEFAULT_RECENCY_HALF_LIFE;
}

/**
 * The recency weight for a prefix: `0.5 ** (ageSinceUse / halfLife)` in `(0, 1]`. A just-used prefix (age 0) weighs 1;
 * one age at the half-life weighs 0.5; it decays smoothly toward 0 as the prefix goes stale, so a fresh prefix outranks
 * an equally-hit stale one. Pure exponential decay — no cutoff, so tiny age differences never flip the ranking abruptly.
 */
function recencyWeight(ageSinceUse: number, halfLife: number): number {
	const age = normalizeNonNegative(ageSinceUse);
	return 0.5 ** (age / halfLife);
}

/**
 * The cost-aware retention VALUE of one cached prefix (higher ⇒ keep first) — the GreedyDual-Size-Frequency-style score.
 *
 * `value = ((hitRate + baseline) × recencyWeight) / tokenCount`, where:
 *   - `hitRate ∈ [0,1]` (clamped; {@link DEFAULT_HIT_RATE} when absent) rewards a prefix that is actually reused;
 *   - a small additive `baseline` (1) keeps a never-hit but recent prefix from collapsing to value 0, so recency still
 *     ranks the zero-hit prefixes among themselves (a freshly-warmed prefix deserves a chance before it has any hits);
 *   - `recencyWeight ∈ (0,1]` ({@link recencyWeight}) down-weights stale prefixes;
 *   - dividing by `tokenCount` makes the value PER TOKEN — a large cache must earn its footprint, because evicting it
 *     frees proportionally more space (the "Size" in GDSF; a plain frequency/recency cache would wrongly keep a huge
 *     rarely-hit prefix over several small hot ones).
 *
 * A zero-size prefix (nothing to reclaim) is treated as maximally valuable to keep (it costs no budget), so it uses the
 * numerator directly rather than dividing by zero. Pinned prefixes short-circuit to {@link Number.POSITIVE_INFINITY} in
 * {@link decidePrefixRetention} before this is consulted; this function scores the UNPINNED ranking. Pure arithmetic.
 */
export function prefixRetentionValue(prefix: CachedPrefix, options?: PrefixRetentionOptions): number {
	const halfLife = resolveHalfLife(options);
	const hitRate = clamp(prefix.hitRate ?? DEFAULT_HIT_RATE, 0, 1);
	const recency = recencyWeight(prefix.ageSinceUse, halfLife);
	// baseline 1 keeps a zero-hit prefix's value proportional to recency instead of collapsing to 0.
	const numerator = (hitRate + 1) * recency;
	const size = normalizeNonNegative(prefix.tokenCount);
	// A zero-footprint prefix reclaims nothing, so it is never worth evicting — rank it by the numerator alone.
	return size > 0 ? numerator / size : numerator;
}

/**
 * Decide which cached prefixes to KEEP vs EVICT to fit a token BUDGET (pure). PINNED prefixes are retained first, in
 * input order, and never evicted — they may push `keptTokens` over the budget, in which case `overBudget` is true and no
 * unpinned prefix is kept (the overflow is reported, never resolved by dropping a pin). The remaining budget is then
 * filled by unpinned prefixes in {@link prefixRetentionValue} order (descending; ties broken by SMALLER footprint — pack
 * more hot prefixes — then by input order for determinism). A prefix whose footprint would exceed the remaining budget is
 * evicted, and — since keeping cache coherent means a larger low-value prefix should yield to several small high-value
 * ones — later smaller prefixes may still be kept after a big one is evicted. A non-positive budget evicts everything
 * unpinned. Never mutates the input; returns fresh arrays.
 *
 * @param prefixes The pool of currently-cached prefixes competing for the budget.
 * @param budgetTokens The prefix-cache budget in tokens (e.g. from `fast-memory-fit.ts` `kvCacheBudgetBytes` converted to
 *   tokens, or a slot-count × per-slot size). Non-finite / negative is treated as 0.
 */
export function decidePrefixRetention(
	prefixes: readonly CachedPrefix[],
	budgetTokens: number,
	options?: PrefixRetentionOptions,
): PrefixRetentionDecision {
	const budget = normalizeNonNegative(budgetTokens);

	const keep: string[] = [];
	const evict: string[] = [];
	let keptTokens = 0;

	// 1) Pinned prefixes are non-negotiable — retain them all (in input order), letting the total overrun if it must.
	for (const prefix of prefixes) {
		if (prefix.pinned) {
			keep.push(prefix.id);
			keptTokens += normalizeNonNegative(prefix.tokenCount);
		}
	}
	const overBudget = keptTokens > budget;

	// 2) Rank the unpinned prefixes by retention value desc, then smaller footprint, then input order (deterministic).
	const ranked = prefixes
		.map((prefix, index) => ({ prefix, index, value: prefixRetentionValue(prefix, options) }))
		.filter((entry) => !entry.prefix.pinned)
		.sort((left, right) => {
			if (right.value !== left.value) {
				return right.value - left.value;
			}
			const bySize = normalizeNonNegative(left.prefix.tokenCount) - normalizeNonNegative(right.prefix.tokenCount);
			if (bySize !== 0) {
				return bySize;
			}
			return left.index - right.index;
		});

	// 3) Keep each unpinned prefix whose footprint fits the remaining budget; evict the rest (lowest value evicted last).
	for (const { prefix } of ranked) {
		const size = normalizeNonNegative(prefix.tokenCount);
		if (!overBudget && keptTokens + size <= budget) {
			keep.push(prefix.id);
			keptTokens += size;
		} else {
			evict.push(prefix.id);
		}
	}

	return {
		keep,
		evict,
		keptTokens,
		overBudget,
		reason: buildReason({ budget, keptTokens, keepCount: keep.length, evictCount: evict.length, overBudget }),
	};
}

/** The outcome of an admission check for a would-be-warmed NEW prefix ({@link shouldAdmitPrefix}). */
export interface PrefixAdmissionDecision {
	/** Whether warming `candidate` is worth it — i.e. it survives retention against the current pool + budget. */
	admit: boolean;
	/** Ids that would be EVICTED from the current pool to make room for `candidate` (empty if it fits without eviction). */
	evict: string[];
	/** Inspectable one-line reason (for logs / debugging). */
	reason: string;
}

/**
 * Decide whether a NEW prefix is worth ADMITTING to the cache — the admission half of the policy, for "should I warm this
 * prefix at all, and if so what do I sacrifice?". It runs {@link decidePrefixRetention} over the current pool WITH the
 * candidate appended, then reports whether the candidate is in the kept set and which incumbents it displaced.
 *
 * A candidate that is LOWER-value than every prefix already filling a full budget is NOT admitted (`admit: false`,
 * `evict: []`) — warming it would evict something more valuable, a net loss (the cost-aware "don't cache a one-shot over a
 * hot shared prefix" guard). A pinned candidate is always admitted. Pure; delegates all scoring to
 * {@link decidePrefixRetention}.
 *
 * @param currentPrefixes The pool already in the cache (the candidate is NOT expected to be among them).
 * @param candidate The new prefix being considered for warming.
 * @param budgetTokens The prefix-cache budget in tokens.
 */
export function shouldAdmitPrefix(
	currentPrefixes: readonly CachedPrefix[],
	candidate: CachedPrefix,
	budgetTokens: number,
	options?: PrefixRetentionOptions,
): PrefixAdmissionDecision {
	const decision = decidePrefixRetention([...currentPrefixes, candidate], budgetTokens, options);
	const admit = decision.keep.includes(candidate.id);
	// Only incumbents (not the candidate) that got evicted count as displaced.
	const evict = admit ? decision.evict.filter((id) => id !== candidate.id) : [];
	const reason = admit
		? evict.length > 0
			? `admit ${candidate.id} — evicts ${evict.length} lower-value prefix(es): ${evict.join(", ")}`
			: `admit ${candidate.id} — fits the budget without eviction`
		: `reject ${candidate.id} — lower value than the incumbents already filling the budget`;
	return { admit, evict, reason };
}

/** Rank a pool of prefixes by retention value WITHOUT applying a budget — for surfacing the eviction order in a panel. */
export function rankPrefixesByRetention(
	prefixes: readonly CachedPrefix[],
	options?: PrefixRetentionOptions,
): RankedPrefix[] {
	return prefixes
		.map((prefix, index) => ({
			id: prefix.id,
			tokenCount: normalizeNonNegative(prefix.tokenCount),
			value: prefix.pinned ? Number.POSITIVE_INFINITY : prefixRetentionValue(prefix, options),
			index,
		}))
		.sort((left, right) => {
			if (right.value !== left.value) {
				return right.value - left.value;
			}
			const bySize = left.tokenCount - right.tokenCount;
			if (bySize !== 0) {
				return bySize;
			}
			return left.index - right.index;
		})
		.map(({ id, tokenCount, value }) => ({ id, tokenCount, value }));
}

/** Compose the human-readable decision reason (kept separate so the policy body stays about the ranking). */
function buildReason(parts: {
	budget: number;
	keptTokens: number;
	keepCount: number;
	evictCount: number;
	overBudget: boolean;
}): string {
	const base = `kept ${parts.keepCount} prefix(es) using ${parts.keptTokens}/${parts.budget} tokens, evicted ${parts.evictCount}`;
	return parts.overBudget ? `${base} — OVER BUDGET (pinned prefixes alone exceed the budget)` : base;
}
