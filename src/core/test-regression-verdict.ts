/**
 * §5.AI dev-test rail — flake/REGRESSION attribution + a decisive verdict (pure).
 *
 * WHAT: the rail runs a project's test suite for a change and gets back a set of PASS/FAIL test results. On its own,
 * "3 tests failed" is not a verdict: some of those failures may already have been failing on the BASELINE (pre-existing —
 * the change didn't cause them), and some may be FLAKY (a test that flips pass/fail run-to-run, so a single red is noise,
 * not a regression). Blaming a change for a pre-existing or flaky failure is exactly how an always-on rail produces false
 * "this change broke X" signals and drowns the real regressions. This core takes the CURRENT run's results, the BASELINE's
 * failing set, and (optionally) each test's recent pass/fail history, and attributes every current failure to one of three
 * classes — then rolls the attribution up into ONE decisive verdict for whether the CHANGE regressed anything.
 *
 * WHY: "which evidence is decisive" is the §5.AI scoring question. The decisive failures are the ones NEWLY introduced by
 * the change (`new_failure`); `pre_existing` and `flake` failures are explicitly NOT charged to the change (they still get
 * surfaced, but they don't flip the verdict to `regressed`). Distinguishing them lets the rail's gate proceed/needs-review/
 * block correctly: block/needs-review only on a genuine new failure, treat an all-pre-existing/flaky run as "not this
 * change's fault", and celebrate `newly_fixed` tests (red on baseline, green now) as positive evidence.
 *
 * Pure + deterministic (no I/O — inputs are INJECTED structured results): given the same results it always yields the same
 * attribution + verdict, so the decision lives in one tested place independent of how the tests were executed.
 *
 * Composes with {@link module:core/completion-stop-reason} / {@link module:core/dev-test-outcome} (run-terminal-state
 * classification) — this answers the orthogonal question "given the tests that ran, did THIS change break any of them?".
 */

/** How a single CURRENT-run test failure is attributed relative to the baseline + the test's own recent history. */
export type FailureAttribution =
	/** Failing now, NOT failing on the baseline, and not judged flaky — the change most likely introduced it. DECISIVE. */
	| "new_failure"
	/** Failing now AND already failing on the baseline — the change did not cause it (pre-existing debt). NOT decisive. */
	| "pre_existing"
	/** The test's recent history shows it flips pass/fail (intermittent); a single red is treated as noise. NOT decisive. */
	| "flake";

/** The overall verdict for whether the CHANGE regressed the suite, derived from the per-failure attributions. */
export type RegressionVerdict =
	/** At least one `new_failure` — the change decisively broke something. */
	| "regressed"
	/** Failures are present but ALL are `pre_existing` and/or `flake` — none charged to the change. */
	| "pre_existing_failures"
	/** No current failures at all. The suite is green for this change. */
	| "clean";

/** One test's result in a single run, plus (optionally) its recent history for flakiness judgement. INJECTED. */
export interface TestResultRecord {
	/** Stable test identifier (suite::name or file::name) — the join key across current/baseline/history. */
	readonly id: string;
	/** True when this test PASSED in the current run, false when it FAILED. */
	readonly passed: boolean;
	/**
	 * Optional recent per-test outcome history (most-recent-first or any order — order is irrelevant), where `true` =
	 * a past pass and `false` = a past fail. Used ONLY to detect flakiness (a mix of both ⇒ flaky). Omit when unknown.
	 */
	readonly recentHistory?: readonly boolean[];
}

export interface ClassifyTestRegressionInput {
	/** Every test from the CURRENT run (passes AND failures). The set of failures is derived from `passed === false`. */
	readonly current: readonly TestResultRecord[];
	/**
	 * The BASELINE's FAILING test ids (e.g. the target branch / last-known-good run). A current failure whose id is here
	 * is `pre_existing`. Pass an empty set when there is no baseline (then every current failure is a candidate new one).
	 */
	readonly baselineFailingIds: readonly string[];
	/**
	 * Minimum recent-history samples required before a mixed pass/fail history counts as "flaky" (default 2 — a single
	 * prior sample is not enough evidence of intermittency). Non-finite / `< 1` values are clamped to 1.
	 */
	readonly flakeMinHistory?: number;
	/**
	 * When true, a flake judgement wins even for a test that is ALSO in the baseline-failing set (report `flake`). When
	 * false (default), `pre_existing` takes precedence over `flake` (a known-failing test is attributed to existing debt,
	 * not called flaky), since a persistently-red baseline test is not intermittent.
	 */
	readonly preferFlakeOverPreExisting?: boolean;
}

/** One attributed current-run failure. */
export interface AttributedFailure {
	readonly id: string;
	readonly attribution: FailureAttribution;
}

export interface TestRegressionClassification {
	readonly verdict: RegressionVerdict;
	/** Every current-run failure with its attribution, sorted `new_failure` → `pre_existing` → `flake`, then by id. */
	readonly failures: readonly AttributedFailure[];
	/** Ids of the DECISIVE failures (the `new_failure`s) — the evidence that flips the verdict to `regressed`. */
	readonly newFailureIds: readonly string[];
	/** Ids failing now that were already failing on the baseline (pre-existing debt, not this change's fault). */
	readonly preExistingIds: readonly string[];
	/** Ids failing now judged flaky by their recent history (treated as noise). */
	readonly flakeIds: readonly string[];
	/** Ids that were failing on the baseline but PASS now — positive evidence the change fixed them. */
	readonly newlyFixedIds: readonly string[];
	readonly counts: {
		readonly totalTests: number;
		readonly passed: number;
		readonly failed: number;
		readonly newFailures: number;
		readonly preExisting: number;
		readonly flake: number;
		readonly newlyFixed: number;
	};
	/** Human-readable one-liner for the operator / rail "what was decisive" surface. */
	readonly summary: string;
}

/** A history counts as flaky when it has ≥ `minHistory` samples AND contains BOTH a pass and a fail (intermittent). */
function isFlakyHistory(history: readonly boolean[] | undefined, minHistory: number): boolean {
	if (history === undefined || history.length < minHistory) {
		return false;
	}
	let sawPass = false;
	let sawFail = false;
	for (const passed of history) {
		if (passed) {
			sawPass = true;
		} else {
			sawFail = true;
		}
		if (sawPass && sawFail) {
			return true;
		}
	}
	return false;
}

const ATTRIBUTION_ORDER: Record<FailureAttribution, number> = {
	new_failure: 0,
	pre_existing: 1,
	flake: 2,
};

/**
 * Attribute every current-run failure to `new_failure` / `pre_existing` / `flake` and derive the decisive
 * {@link RegressionVerdict} (pure). Precedence for a failing test:
 *   1. `pre_existing` if its id is in `baselineFailingIds` (unless `preferFlakeOverPreExisting` and it is flaky);
 *   2. else `flake` if its recent history is intermittent (≥ `flakeMinHistory` samples with both a pass and a fail);
 *   3. else `new_failure`.
 * The verdict is `regressed` iff ≥1 `new_failure`, else `pre_existing_failures` if any failure remains, else `clean`.
 * A later duplicate id in `current` overrides an earlier one (last write wins) so a re-reported test doesn't double-count.
 */
export function classifyTestRegression(input: ClassifyTestRegressionInput): TestRegressionClassification {
	const minHistory =
		typeof input.flakeMinHistory === "number" && Number.isFinite(input.flakeMinHistory)
			? Math.max(1, Math.floor(input.flakeMinHistory))
			: 2;
	const preferFlake = input.preferFlakeOverPreExisting === true;
	const baselineFailing = new Set(input.baselineFailingIds);

	// Dedup current results by id (last write wins) so a re-reported test is counted once.
	const byId = new Map<string, TestResultRecord>();
	for (const record of input.current) {
		byId.set(record.id, record);
	}

	const failures: AttributedFailure[] = [];
	const newFailureIds: string[] = [];
	const preExistingIds: string[] = [];
	const flakeIds: string[] = [];
	let passed = 0;

	// Ids that failed on the baseline and PASS now (or no longer appear as failing) = newly fixed. Start from the whole
	// baseline-failing set and remove any that are still failing below.
	const stillFailingFromBaseline = new Set<string>();

	for (const record of byId.values()) {
		if (record.passed) {
			passed += 1;
			continue;
		}
		const inBaseline = baselineFailing.has(record.id);
		if (inBaseline) {
			stillFailingFromBaseline.add(record.id);
		}
		const flaky = isFlakyHistory(record.recentHistory, minHistory);

		let attribution: FailureAttribution;
		if (inBaseline && !(preferFlake && flaky)) {
			attribution = "pre_existing";
			preExistingIds.push(record.id);
		} else if (flaky) {
			attribution = "flake";
			flakeIds.push(record.id);
		} else {
			attribution = "new_failure";
			newFailureIds.push(record.id);
		}
		failures.push({ id: record.id, attribution });
	}

	const newlyFixedIds = [...baselineFailing].filter((id) => !stillFailingFromBaseline.has(id)).sort();

	failures.sort(
		(left, right) =>
			ATTRIBUTION_ORDER[left.attribution] - ATTRIBUTION_ORDER[right.attribution] || left.id.localeCompare(right.id),
	);
	newFailureIds.sort();
	preExistingIds.sort();
	flakeIds.sort();

	const failed = failures.length;
	const verdict: RegressionVerdict =
		newFailureIds.length > 0 ? "regressed" : failed > 0 ? "pre_existing_failures" : "clean";

	return {
		verdict,
		failures,
		newFailureIds,
		preExistingIds,
		flakeIds,
		newlyFixedIds,
		counts: {
			totalTests: byId.size,
			passed,
			failed,
			newFailures: newFailureIds.length,
			preExisting: preExistingIds.length,
			flake: flakeIds.length,
			newlyFixed: newlyFixedIds.length,
		},
		summary: formatRegressionSummary(verdict, newFailureIds, preExistingIds, flakeIds, newlyFixedIds),
	};
}

function formatRegressionSummary(
	verdict: RegressionVerdict,
	newFailureIds: readonly string[],
	preExistingIds: readonly string[],
	flakeIds: readonly string[],
	newlyFixedIds: readonly string[],
): string {
	const fixed = newlyFixedIds.length > 0 ? ` Fixed ${newlyFixedIds.length} previously-failing test(s).` : "";
	switch (verdict) {
		case "regressed":
			return (
				`REGRESSED: ${newFailureIds.length} new failure(s) introduced by this change` +
				` (${newFailureIds.join(", ")})` +
				`${preExistingIds.length > 0 ? `; ${preExistingIds.length} pre-existing` : ""}` +
				`${flakeIds.length > 0 ? `; ${flakeIds.length} flaky` : ""}.${fixed}`
			);
		case "pre_existing_failures":
			return (
				"No new failures from this change — " +
				`${preExistingIds.length} pre-existing and ${flakeIds.length} flaky failure(s) are not charged to it.${fixed}`
			);
		case "clean":
			return `Clean: no current failures.${fixed}`;
	}
}

/**
 * The rail's gate decision derived from a {@link RegressionVerdict}: a `regressed` verdict blocks (a real regression),
 * `pre_existing_failures` is `needs_review` (the run is red but not this change's fault — surface it, don't auto-block on
 * it), and `clean` proceeds. Pure so the rail's proceed/needs-review/block mapping is one tested place.
 */
export function regressionGateDecision(verdict: RegressionVerdict): "proceed" | "needs_review" | "block" {
	switch (verdict) {
		case "regressed":
			return "block";
		case "pre_existing_failures":
			return "needs_review";
		case "clean":
			return "proceed";
	}
}
