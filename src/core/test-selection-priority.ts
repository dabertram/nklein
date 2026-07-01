/**
 * §5.AI dev-test rail — CHANGED-FILE test-selection PRIORITIZER (pure).
 *
 * WHAT: the always-on rail wants FAST, decisive signal about a change before it commits the loaded models to a full,
 * slow suite pass on a small local model. Given the CHANGED files of a change and per-test METADATA (which files each
 * test exercises, its recent failure history, whether it is new/never-run, an optional flakiness score, and its last
 * observed duration), this core produces a deterministic PRIORITY ORDER over the tests and carves out the subset to run
 * FIRST — the tests most likely to catch a regression introduced by exactly this change, cheapest-feedback-first.
 *
 * WHY: running tests in file order (or all-at-once) wastes the rail's scarce model time — a regression in a just-touched
 * module is caught fastest by running the tests that touch that module up front, and by front-loading tests that have
 * recently gone red (the change may have re-broken them). Conversely a KNOWN-flaky test is a poor early gate (its red is
 * noise, see {@link module:core/test-regression-verdict}), so it is nudged DOWN rather than up. Cheapest-first tie-break
 * means the rail gets the maximum number of decisive results per wall-second, so it can `fail fast` and hand the
 * evidence to the analysis pass without paying for the long tail.
 *
 * The scoring is a transparent weighted sum of independent SIGNALS so the policy lives in one tested place:
 *   directly-impacted (a test exercises a changed file)  — the strongest signal, weighted highest by default
 *   recently-failed    (red in the recent window)        — likely still/again broken
 *   new/never-run      (no history to trust)             — must be exercised at least once
 *   flaky              (intermittent history)            — a SMALL PENALTY: a noisy early gate, deprioritized
 * Ties break toward SHORTER last-duration (fast feedback), then by id (stable, deterministic).
 *
 * Pure + deterministic (no fs/glob/coverage-tool/test-runner — every signal is INJECTED as structured metadata): the
 * ORDER is a property of the inputs alone, independent of how the changed files or the test metadata were gathered.
 *
 * Composes with {@link module:core/test-regression-verdict}: prioritize → run the selected subset → classify the
 * results. Orthogonal to it — this answers "which tests should the rail run FIRST for this change?", not "did the run
 * regress?".
 */

/** How a changed file participates in impact matching. Purely advisory today (all kinds count as an impact) but kept so
 * a caller can carry intent (a delete is still an impact — dependents may break) without a lossy re-encode later. */
export type ChangeKind = "added" | "modified" | "deleted" | "renamed";

/** One file that the change touched. INJECTED (e.g. from a diff); this core does not read the filesystem. */
export interface ChangedFile {
	/** Repo-relative path of the changed file, e.g. `src/core/foo.ts`. Compared for equality against `Test.files`. */
	readonly path: string;
	/** Optional change kind. All kinds count as an impact; carried for the caller's own downstream use. */
	readonly kind?: ChangeKind;
}

/** One candidate test with the metadata the prioritizer scores. All fields but `id` are optional/INJECTED. */
export interface CandidateTest {
	/** Stable test identifier (file::name or suite::name) — the join key + the final deterministic tie-break. */
	readonly id: string;
	/**
	 * The repo-relative source files this test is known to EXERCISE (its own file plus, when known, the modules under
	 * test). A test is `directly-impacted` when any entry equals a `ChangedFile.path`. Omit/empty when unknown — then the
	 * test simply earns no impact signal (it is not penalised, just not boosted).
	 */
	readonly files?: readonly string[];
	/** How many times this test FAILED in the recent window (any non-negative count). Drives the recently-failed signal. */
	readonly recentFailures?: number;
	/**
	 * True when this test is new / has never been run before (no history to trust) — it must be exercised at least once,
	 * so it earns the new-test signal. Distinct from `recentFailures` (which needs history).
	 */
	readonly isNew?: boolean;
	/**
	 * Optional flakiness score in [0,1] (0 = stable, 1 = maximally intermittent) — e.g. the pass/fail-flip rate over recent
	 * history. Values are clamped to [0,1]. A positive score applies a SMALL PENALTY: a flaky test is a poor early gate.
	 */
	readonly flakeScore?: number;
	/** Last observed wall-time in ms (≥0). Used only as the cheapest-first tie-break; unknown/omit sorts as `+Infinity`. */
	readonly lastDurationMs?: number;
}

/** Tunable signal weights (all default to sensible values). A caller may override to re-shape the policy. */
export interface TestSelectionWeights {
	/** Added to a test's score when it exercises a changed file. The dominant signal. Default 100. */
	readonly directlyImpacted?: number;
	/** Multiplied by `recentFailures` (capped by `recentFailureCap`) and added. Default 20 per recent failure. */
	readonly recentFailure?: number;
	/** Max recent-failure count that still contributes (so one chronically-red test can't dominate). Default 3. */
	readonly recentFailureCap?: number;
	/** Added when `isNew`. Default 15. */
	readonly newTest?: number;
	/** SUBTRACTED, scaled by the clamped `flakeScore` (penalty at score 1). Default 10. */
	readonly flakePenalty?: number;
}

export interface PrioritizeTestSelectionInput {
	/** The change's touched files. INJECTED. Empty ⇒ no test earns the directly-impacted signal (order by the rest). */
	readonly changedFiles: readonly ChangedFile[];
	/** The candidate tests with their metadata. INJECTED. */
	readonly tests: readonly CandidateTest[];
	/** Optional weight overrides. */
	readonly weights?: TestSelectionWeights;
	/**
	 * Cap the SELECTED-first subset to at most this many tests (the highest-priority ones). Non-finite / `< 0` ⇒ ignored.
	 * When both `topN` and `timeBudgetMs` are given, BOTH bounds apply (a test must fit under each).
	 */
	readonly topN?: number;
	/**
	 * Cap the SELECTED-first subset to a wall-time budget in ms, filling in priority order by each test's `lastDurationMs`
	 * (a test with unknown duration is treated as 0 for budgeting — it is cheap-to-admit but sorts last on the tie-break).
	 * Non-finite / `< 0` ⇒ ignored. With neither bound set, ALL tests are selected (pure ordering, no subset carve-out).
	 */
	readonly timeBudgetMs?: number;
}

/** Which independent signals fired for a test (for the operator "why this order" surface). */
export interface TestSelectionSignals {
	readonly directlyImpacted: boolean;
	readonly recentlyFailed: boolean;
	readonly isNew: boolean;
	readonly flaky: boolean;
}

/** One scored + ordered test. */
export interface PrioritizedTest {
	readonly id: string;
	/** The weighted-sum score (higher = run earlier). Deterministic given the inputs. */
	readonly score: number;
	/** The signals that contributed, for explanation. */
	readonly signals: TestSelectionSignals;
	/** The last duration used for the cheapest-first tie-break / budgeting (`null` when unknown). */
	readonly lastDurationMs: number | null;
	/** Human-readable one-liner naming the signals that ranked this test. */
	readonly reason: string;
}

export interface TestSelectionResult {
	/** ALL candidate tests in priority order (highest score first; ties → cheaper, then id). Deduped by id. */
	readonly ordered: readonly PrioritizedTest[];
	/** The highest-priority prefix chosen to RUN FIRST, honouring `topN` and/or `timeBudgetMs` (or all when neither set). */
	readonly selected: readonly PrioritizedTest[];
	/** The remaining tests (ordered), deferred behind `selected`. `selected` ++ `deferred` === `ordered`. */
	readonly deferred: readonly PrioritizedTest[];
	readonly counts: {
		readonly total: number;
		readonly selected: number;
		readonly deferred: number;
		readonly directlyImpacted: number;
		readonly recentlyFailed: number;
		readonly isNew: number;
		readonly flaky: number;
	};
	/** Estimated wall-time of `selected` (sum of known durations; unknown counted as 0). */
	readonly selectedDurationMs: number;
	/** Human-readable one-liner for the rail "what will run first + why" surface. */
	readonly summary: string;
}

const DEFAULT_WEIGHTS: Required<TestSelectionWeights> = {
	directlyImpacted: 100,
	recentFailure: 20,
	recentFailureCap: 3,
	newTest: 15,
	flakePenalty: 10,
};

/** Clamp to [0,1]; non-finite ⇒ 0. */
function clamp01(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return 0;
	}
	if (value <= 0) {
		return 0;
	}
	return value >= 1 ? 1 : value;
}

/** A finite, non-negative count (floored); anything else ⇒ 0. */
function nonNegativeCount(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return Math.floor(value);
}

/** A finite, non-negative bound; anything else ⇒ undefined (bound not applied). */
function optionalBound(value: number | undefined): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return undefined;
	}
	return value;
}

/**
 * Prioritize the candidate tests for a change and carve out the run-first subset (pure). Each test's score is a weighted
 * sum of the independent signals (directly-impacted + recently-failed + new − flaky-penalty); the order is
 * highest-score-first, breaking ties toward a SHORTER last duration (fast feedback), then by id for full determinism.
 * The `selected` prefix is the highest-priority tests that fit under `topN` and/or `timeBudgetMs` (all of them when
 * neither bound is set). A later duplicate id in `tests` overrides an earlier one (last write wins) so a re-listed test
 * is scored once.
 */
export function prioritizeTestSelection(input: PrioritizeTestSelectionInput): TestSelectionResult {
	const weights: Required<TestSelectionWeights> = {
		directlyImpacted: finiteOr(input.weights?.directlyImpacted, DEFAULT_WEIGHTS.directlyImpacted),
		recentFailure: finiteOr(input.weights?.recentFailure, DEFAULT_WEIGHTS.recentFailure),
		recentFailureCap: Math.max(
			0,
			Math.floor(finiteOr(input.weights?.recentFailureCap, DEFAULT_WEIGHTS.recentFailureCap)),
		),
		newTest: finiteOr(input.weights?.newTest, DEFAULT_WEIGHTS.newTest),
		flakePenalty: finiteOr(input.weights?.flakePenalty, DEFAULT_WEIGHTS.flakePenalty),
	};
	const changedPaths = new Set(input.changedFiles.map((file) => file.path));

	// Dedup candidates by id (last write wins) so a re-listed test is scored once.
	const byId = new Map<string, CandidateTest>();
	for (const test of input.tests) {
		byId.set(test.id, test);
	}

	const ordered: PrioritizedTest[] = [];
	for (const test of byId.values()) {
		const directlyImpacted = changedPaths.size > 0 && (test.files ?? []).some((file) => changedPaths.has(file));
		const recentFailures = Math.min(nonNegativeCount(test.recentFailures), weights.recentFailureCap);
		const recentlyFailed = recentFailures > 0;
		const isNew = test.isNew === true;
		const flakeScore = clamp01(test.flakeScore);
		const flaky = flakeScore > 0;

		let score = 0;
		if (directlyImpacted) {
			score += weights.directlyImpacted;
		}
		score += recentFailures * weights.recentFailure;
		if (isNew) {
			score += weights.newTest;
		}
		score -= flakeScore * weights.flakePenalty;

		const lastDurationMs =
			typeof test.lastDurationMs === "number" && Number.isFinite(test.lastDurationMs) && test.lastDurationMs >= 0
				? test.lastDurationMs
				: null;

		ordered.push({
			id: test.id,
			score,
			signals: { directlyImpacted, recentlyFailed, isNew, flaky },
			lastDurationMs,
			reason: formatReason({ directlyImpacted, recentlyFailed, isNew, flaky }, recentFailures),
		});
	}

	ordered.sort(compareByPriority);

	// Carve out the selected-first subset under the (optional) bounds. Unknown duration counts as 0 for budgeting.
	const topN = optionalBound(input.topN);
	const timeBudgetMs = optionalBound(input.timeBudgetMs);
	const selected: PrioritizedTest[] = [];
	const deferred: PrioritizedTest[] = [];
	let selectedDurationMs = 0;
	for (const test of ordered) {
		const cost = test.lastDurationMs ?? 0;
		const underCount = topN === undefined || selected.length < topN;
		const underBudget = timeBudgetMs === undefined || selectedDurationMs + cost <= timeBudgetMs;
		if (underCount && underBudget) {
			selected.push(test);
			selectedDurationMs += cost;
		} else {
			deferred.push(test);
		}
	}

	const counts = {
		total: ordered.length,
		selected: selected.length,
		deferred: deferred.length,
		directlyImpacted: ordered.filter((test) => test.signals.directlyImpacted).length,
		recentlyFailed: ordered.filter((test) => test.signals.recentlyFailed).length,
		isNew: ordered.filter((test) => test.signals.isNew).length,
		flaky: ordered.filter((test) => test.signals.flaky).length,
	};

	return {
		ordered,
		selected,
		deferred,
		counts,
		selectedDurationMs,
		summary: formatSummary(counts, selectedDurationMs),
	};
}

function finiteOr(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Higher score first; then SHORTER duration (unknown = +Infinity, i.e. last); then id ascending. Fully deterministic. */
function compareByPriority(left: PrioritizedTest, right: PrioritizedTest): number {
	if (left.score !== right.score) {
		return right.score - left.score;
	}
	const leftCost = left.lastDurationMs ?? Number.POSITIVE_INFINITY;
	const rightCost = right.lastDurationMs ?? Number.POSITIVE_INFINITY;
	if (leftCost !== rightCost) {
		return leftCost - rightCost;
	}
	return left.id.localeCompare(right.id);
}

function formatReason(signals: TestSelectionSignals, recentFailures: number): string {
	const parts: string[] = [];
	if (signals.directlyImpacted) {
		parts.push("touches a changed file");
	}
	if (signals.recentlyFailed) {
		parts.push(`recently failed x${recentFailures}`);
	}
	if (signals.isNew) {
		parts.push("new/never-run");
	}
	if (signals.flaky) {
		parts.push("flaky (deprioritized)");
	}
	return parts.length > 0 ? parts.join("; ") : "no priority signal";
}

function formatSummary(counts: TestSelectionResult["counts"], selectedDurationMs: number): string {
	if (counts.total === 0) {
		return "No candidate tests to prioritize.";
	}
	const budget = selectedDurationMs > 0 ? ` (~${selectedDurationMs} ms)` : "";
	return (
		`Run ${counts.selected}/${counts.total} test(s) first${budget}: ` +
		`${counts.directlyImpacted} impacted, ${counts.recentlyFailed} recently-failed, ${counts.isNew} new` +
		`${counts.flaky > 0 ? `, ${counts.flaky} flaky deprioritized` : ""}.`
	);
}
