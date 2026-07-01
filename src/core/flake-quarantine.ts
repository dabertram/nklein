/**
 * §5.AI dev-test rail — per-test FLAKE-QUARANTINE policy (pure).
 *
 * WHAT: the always-on rail runs a project's suite over and over on small local models, so it accumulates a per-test
 * PASS/FAIL HISTORY. This core takes each test's recent history (INJECTED as a plain `boolean[]`, `true` = pass) and
 * decides what to DO about the test's reliability: `trust` (stable enough to gate on), `watch` (showing some
 * intermittency but not yet bad enough to isolate, or not yet enough evidence), or `quarantine` (chronically flaky —
 * its red is noise, so keep RUNNING it for data but stop letting it BLOCK a delivery decision). It also derives, for
 * every test, the two scalars the rest of the rail already expects as INPUTS — the flip-based `flakeScore` in [0,1] and
 * the recent-fail count — plus a worst-first rollup and the set of quarantined ids.
 *
 * WHY: two shipped §5.AI cores CONSUME a flake signal but neither PRODUCES it from raw history, so today it has to be
 * hand-fed:
 *   - `test-selection-priority.ts` takes a `flakeScore` in [0,1] ("e.g. the pass/fail-flip rate over recent history")
 *     to DEPRIORITIZE a flaky test as an early gate — but nothing computes that flip-rate.
 *   - `test-regression-verdict.ts` judges a SINGLE run's failure as flake vs new_failure from `recentHistory`, but it
 *     makes no DURABLE per-test classification and no operational quarantine/watch/trust decision.
 * A chronically-flaky test that keeps flipping red is exactly how an always-on rail produces false "this change broke X"
 * alarms and burns scarce model time re-running a coin-flip. This module is the missing PRODUCER: one tested place that
 * turns per-test history into (a) the durable `quarantine | watch | trust` action, (b) the `flakeScore` map to feed the
 * prioritizer, and (c) the recent-fail counts + quarantined-id set the rail's other gates read.
 *
 * The `flakeScore` here is a genuine INTERMITTENCY (flip-rate) measure, NOT a fail-rate: a test that fails EVERY run is
 * perfectly deterministic (score 0 — it is broken, not flaky) and a test that passes EVERY run is stable (score 0);
 * only a test whose outcomes ALTERNATE scores high. Flip-rate = (number of adjacent outcome CHANGES in chronological
 * order) / (samples − 1). So `P F P F` (3 flips over 3 gaps) → 1.0, `P P F F` (1 flip) → ~0.33, `F F F` → 0. History
 * order therefore MATTERS here (unlike `test-regression-verdict`'s order-agnostic "saw both" check); callers pass
 * newest-first or oldest-first via {@link FlakeQuarantineInput.historyOrder} (default newest-first) — flip COUNT is the
 * same either way, but it keeps the contract explicit.
 *
 * Pure + deterministic (no I/O / test-runner / clock — histories are INJECTED structured results): the same histories
 * always yield the same classification, so the quarantine policy lives in one place independent of how tests were run.
 *
 * Composes by DATA with {@link module:core/test-selection-priority} (feed `flakeScoresById[id]` as each candidate's
 * `flakeScore`, and skip/append `quarantinedIds`) and with {@link module:core/test-regression-verdict} (a quarantined
 * test's current-run failure can be dropped from the decisive set) — this answers the orthogonal question "which tests
 * are too flaky to trust, and what should we do about each?".
 */

/** What to DO about a test given its recent reliability. Ordered by severity for stable worst-first sorting. */
export type FlakeAction =
	/** Chronically intermittent (flip-rate ≥ the quarantine bar with enough samples). KEEP running it for data, but its
	 *  red must NOT block a delivery decision — its outcome is noise. The most severe action. */
	| "quarantine"
	/** Showing SOME intermittency (a flip below the quarantine bar) OR too few samples to trust yet — track it, warn, but
	 *  still let it gate. The middle action. */
	| "watch"
	/** Stable across the window (no flips, or consistently pass/fail) with enough samples — safe to gate on. */
	| "trust";

/** One test's raw recent history to classify. INJECTED (e.g. from the rail's accumulated run evidence). */
export interface TestFlakeHistory {
	/** Stable test identifier (file::name or suite::name) — the join key + the final deterministic tie-break. */
	readonly id: string;
	/**
	 * Recent per-run outcomes, `true` = passed / `false` = failed. Ordered per {@link FlakeQuarantineInput.historyOrder}
	 * (default newest-first). Empty/omitted ⇒ no evidence (classified `watch` when watch-on-insufficient is on, else
	 * `trust`), score 0. A `history` longer than `windowSize` is truncated to the most-recent `windowSize` outcomes.
	 */
	readonly outcomes?: readonly boolean[];
}

/** Tunable policy thresholds (all default to sensible values). */
export interface FlakeQuarantinePolicy {
	/**
	 * Minimum number of recent samples required before a test can be classified `trust` or `quarantine` at all — below
	 * this there is not enough evidence, so the test is `watch` (when `watchOnInsufficientHistory`, the default) . Clamped
	 * to ≥ 2 (a flip needs at least two samples). Default 4.
	 */
	readonly minSamples?: number;
	/**
	 * Cap the history considered to the most-recent N outcomes (older ones are dropped before scoring), so a long-ago
	 * flaky streak that has since settled ages out. Clamped to ≥ `minSamples`. Default 10.
	 */
	readonly windowSize?: number;
	/**
	 * Flip-rate in [0,1] AT OR ABOVE which a test with enough samples is `quarantine`d. Clamped to [0,1]. Default 0.5
	 * (outcomes change on at least half the run-to-run gaps ⇒ a coin-flip, quarantine).
	 */
	readonly quarantineFlipRate?: number;
	/**
	 * Flip-rate in [0,1] AT OR ABOVE which a test with enough samples is at least `watch` (below `quarantineFlipRate`).
	 * Clamped to [0, quarantineFlipRate]. Any flip strictly below this ⇒ `trust`. Default 0 (ANY flip ⇒ at least watch).
	 */
	readonly watchFlipRate?: number;
	/**
	 * When true (default), a test with FEWER than `minSamples` outcomes is `watch` (unproven — do not yet trust). When
	 * false, insufficient history is `trust` (optimistic — a brand-new test is not assumed flaky).
	 */
	readonly watchOnInsufficientHistory?: boolean;
}

/** Whether an injected `outcomes` array is newest-first or oldest-first. Flip COUNT is identical either way; explicit. */
export type HistoryOrder = "newest-first" | "oldest-first";

export interface FlakeQuarantineInput {
	/** The per-test histories to classify. INJECTED. */
	readonly tests: readonly TestFlakeHistory[];
	/** Optional policy overrides. */
	readonly policy?: FlakeQuarantinePolicy;
	/** Order of each `outcomes` array. Default `newest-first`. Only affects which samples the window keeps, not the score. */
	readonly historyOrder?: HistoryOrder;
}

/** One classified test. */
export interface ClassifiedFlakeTest {
	readonly id: string;
	readonly action: FlakeAction;
	/**
	 * Intermittency in [0,1]: adjacent-outcome flips / (samples − 1) over the windowed history. 0 = deterministic
	 * (always pass OR always fail) or < 2 samples; 1 = alternates every run. This is exactly the value
	 * `test-selection-priority.ts` expects as a test's `flakeScore`.
	 */
	readonly flakeScore: number;
	/** How many of the windowed samples were FAILS (a bare fail count, for the rail's other gates). */
	readonly recentFailures: number;
	/** Number of windowed samples actually considered (after truncation to `windowSize`). */
	readonly samples: number;
	/** Number of adjacent-outcome changes in the windowed history (the flip COUNT the score is built from). */
	readonly flips: number;
	/** Human-readable one-liner naming why this action was chosen, for the operator "why quarantined" surface. */
	readonly reason: string;
}

export interface FlakeQuarantineResult {
	/** Every classified test, WORST-first: `quarantine` → `watch` → `trust`, then by descending flakeScore, then id. */
	readonly tests: readonly ClassifiedFlakeTest[];
	/** Ids classified `quarantine` (skip as a gate / isolate). Same order as `tests`. */
	readonly quarantinedIds: readonly string[];
	/** Ids classified `watch`. Same order as `tests`. */
	readonly watchIds: readonly string[];
	/**
	 * The `flakeScore` for every test keyed by id — ready to hand to `test-selection-priority.ts` (as each candidate's
	 * `flakeScore`). Deduped last-write-wins, matching the classification.
	 */
	readonly flakeScoresById: Readonly<Record<string, number>>;
	readonly counts: {
		readonly total: number;
		readonly quarantined: number;
		readonly watched: number;
		readonly trusted: number;
	};
	/** Human-readable one-liner for the rail "flake health" surface. */
	readonly summary: string;
}

const DEFAULT_POLICY: Required<FlakeQuarantinePolicy> = {
	minSamples: 4,
	windowSize: 10,
	quarantineFlipRate: 0.5,
	watchFlipRate: 0,
	watchOnInsufficientHistory: true,
};

/** Clamp to [0,1]; non-finite ⇒ fallback. */
function clamp01(value: number | undefined, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	if (value <= 0) {
		return 0;
	}
	return value >= 1 ? 1 : value;
}

/** A finite integer ≥ `min`; anything else ⇒ `fallback` (itself floored to ≥ `min`). */
function intAtLeast(value: number | undefined, min: number, fallback: number): number {
	const base = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
	return Math.max(min, base);
}

/** Resolve the policy with clamps + the documented interdependencies (windowSize ≥ minSamples, watch ≤ quarantine). */
function resolvePolicy(policy: FlakeQuarantinePolicy | undefined): Required<FlakeQuarantinePolicy> {
	const minSamples = intAtLeast(policy?.minSamples, 2, DEFAULT_POLICY.minSamples);
	const windowSize = intAtLeast(policy?.windowSize, minSamples, Math.max(minSamples, DEFAULT_POLICY.windowSize));
	const quarantineFlipRate = clamp01(policy?.quarantineFlipRate, DEFAULT_POLICY.quarantineFlipRate);
	// watch bar can never exceed the quarantine bar (else a test could be "≥ watch" yet not quarantined nonsensically).
	const watchFlipRate = Math.min(clamp01(policy?.watchFlipRate, DEFAULT_POLICY.watchFlipRate), quarantineFlipRate);
	const watchOnInsufficientHistory = policy?.watchOnInsufficientHistory !== false;
	return { minSamples, windowSize, quarantineFlipRate, watchFlipRate, watchOnInsufficientHistory };
}

/** Keep the most-recent `windowSize` outcomes given the array's order (newest-first ⇒ prefix; oldest-first ⇒ suffix). */
function windowedOutcomes(outcomes: readonly boolean[], windowSize: number, order: HistoryOrder): readonly boolean[] {
	if (outcomes.length <= windowSize) {
		return outcomes;
	}
	return order === "newest-first" ? outcomes.slice(0, windowSize) : outcomes.slice(outcomes.length - windowSize);
}

/** Count adjacent-outcome changes (flips) in a sequence. Order-direction-independent as a COUNT. */
function countFlips(outcomes: readonly boolean[]): number {
	let flips = 0;
	for (let i = 1; i < outcomes.length; i += 1) {
		if (outcomes[i] !== outcomes[i - 1]) {
			flips += 1;
		}
	}
	return flips;
}

const ACTION_ORDER: Record<FlakeAction, number> = { quarantine: 0, watch: 1, trust: 2 };

/**
 * Classify each test's recent history into a `quarantine | watch | trust` action and derive its `flakeScore` (pure).
 * The decision for a test:
 *   1. Fewer than `minSamples` windowed outcomes ⇒ `watch` (when `watchOnInsufficientHistory`, default) else `trust`,
 *      score 0 — not enough evidence to judge intermittency.
 *   2. Else flip-rate = flips / (samples − 1): `quarantine` if ≥ `quarantineFlipRate`; else `watch` if ≥ `watchFlipRate`
 *      (and > 0 flips); else `trust`.
 * The result is sorted worst-first (`quarantine` → `watch` → `trust`, then descending flakeScore, then id) so the most
 * dangerous tests surface first. A later duplicate id in `tests` overrides an earlier one (last write wins).
 */
export function classifyFlakeQuarantine(input: FlakeQuarantineInput): FlakeQuarantineResult {
	const policy = resolvePolicy(input.policy);
	const order: HistoryOrder = input.historyOrder === "oldest-first" ? "oldest-first" : "newest-first";

	// Dedup by id (last write wins) so a re-listed test is classified once.
	const byId = new Map<string, TestFlakeHistory>();
	for (const test of input.tests) {
		byId.set(test.id, test);
	}

	const classified: ClassifiedFlakeTest[] = [];
	for (const test of byId.values()) {
		const raw = test.outcomes ?? [];
		const windowed = windowedOutcomes(raw, policy.windowSize, order);
		const samples = windowed.length;
		const recentFailures = windowed.reduce((n, passed) => (passed ? n : n + 1), 0);

		if (samples < policy.minSamples) {
			const action: FlakeAction = policy.watchOnInsufficientHistory ? "watch" : "trust";
			classified.push({
				id: test.id,
				action,
				flakeScore: 0,
				recentFailures,
				samples,
				flips: 0,
				reason:
					samples === 0
						? `no run history (< ${policy.minSamples} samples) → ${action}`
						: `only ${samples} sample(s) (< ${policy.minSamples}) → ${action}`,
			});
			continue;
		}

		const flips = countFlips(windowed);
		const flakeScore = flips / (samples - 1);
		let action: FlakeAction;
		let reason: string;
		if (flakeScore >= policy.quarantineFlipRate) {
			action = "quarantine";
			reason = `flip-rate ${formatRate(flakeScore)} ≥ ${formatRate(policy.quarantineFlipRate)} over ${samples} runs → quarantine`;
		} else if (flips > 0 && flakeScore >= policy.watchFlipRate) {
			action = "watch";
			reason = `flip-rate ${formatRate(flakeScore)} (≥ ${formatRate(policy.watchFlipRate)}, < ${formatRate(policy.quarantineFlipRate)}) → watch`;
		} else {
			action = "trust";
			reason =
				flips === 0
					? `stable over ${samples} runs (no flips) → trust`
					: `flip-rate ${formatRate(flakeScore)} < ${formatRate(policy.watchFlipRate)} → trust`;
		}
		classified.push({ id: test.id, action, flakeScore, recentFailures, samples, flips, reason });
	}

	classified.sort((a, b) => {
		const byAction = ACTION_ORDER[a.action] - ACTION_ORDER[b.action];
		if (byAction !== 0) {
			return byAction;
		}
		if (b.flakeScore !== a.flakeScore) {
			return b.flakeScore - a.flakeScore;
		}
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});

	const quarantinedIds: string[] = [];
	const watchIds: string[] = [];
	const flakeScoresById: Record<string, number> = {};
	let trusted = 0;
	for (const t of classified) {
		flakeScoresById[t.id] = t.flakeScore;
		if (t.action === "quarantine") {
			quarantinedIds.push(t.id);
		} else if (t.action === "watch") {
			watchIds.push(t.id);
		} else {
			trusted += 1;
		}
	}

	const counts = {
		total: classified.length,
		quarantined: quarantinedIds.length,
		watched: watchIds.length,
		trusted,
	};

	return {
		tests: classified,
		quarantinedIds,
		watchIds,
		flakeScoresById,
		counts,
		summary: buildSummary(counts),
	};
}

/** Compact percent for a rate in [0,1] (`0.5` → `50%`), keeping reasons terse + stable. */
function formatRate(rate: number): string {
	return `${Math.round(rate * 100)}%`;
}

function buildSummary(counts: FlakeQuarantineResult["counts"]): string {
	if (counts.total === 0) {
		return "no tests to classify";
	}
	return `${counts.total} test(s): ${counts.quarantined} quarantined, ${counts.watched} watched, ${counts.trusted} trusted`;
}
