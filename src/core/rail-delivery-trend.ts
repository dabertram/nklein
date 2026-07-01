/**
 * §5.AI dev-test rail — per-scenario delivery TREND over the harvested run history (pure).
 *
 * WHAT: the rail persists one `RailEvidenceReport` per run (each stamped with `at` + `model`), and
 * {@link module:core/rail-evidence} `aggregateRailEvidence` pools them into a worst-first scorecard. But that rollup is
 * TIMELESS — it drops every report into one bucket, so it cannot tell a scenario that JUST started failing (a fresh
 * delivery regression — decisive, urgent) apart from one that has ALWAYS been at 50% (chronic, long-known). Those two
 * deserve very different attention, yet they land at the same delivery rate. This core adds the missing time dimension:
 * it orders each scenario's runs chronologically by `at`, splits the history into an EARLIER baseline window and a
 * RECENT window, and classifies the per-scenario direction as `improving | stable | regressing | insufficient_data`
 * from the delivery-rate delta between the windows.
 *
 * WHY: the §5.AI vision wants the rail to capture BOTH "proof it STILL works on model M / project P" over successive
 * runs (a scenario that recovered → `improving`, positive evidence) AND *sleeping* issues surfaced with priority (a
 * scenario whose recent runs stopped delivering → `regressing`, the thing the analysis pass should propose a bullet for
 * FIRST). "Which evidence is decisive" is §5.AI's scoring question; a delivery regression that emerged over the last few
 * runs is exactly the decisive, act-now signal that a single worst-first snapshot cannot express.
 *
 * Pure + deterministic (no I/O — the harvested reports are INJECTED structured values): given the same reports it always
 * yields the same trend, so the "is this scenario getting better or worse?" judgement lives in one tested place
 * independent of how the reports were collected. Timestamps are parsed with `Date.parse` on the injected strings only
 * (no `Date.now()`), and runs with an unparseable `at` are ordered AFTER dated runs by their input position, so a
 * missing timestamp degrades gracefully rather than throwing.
 *
 * Composes by IMPORT with {@link module:core/rail-evidence} (reuses its `RailEvidenceReport`/`RailLaneEvidence` shapes;
 * a caller reads the same `rail-*.json` harvest for both the snapshot rollup and this trend) and is orthogonal to
 * {@link module:core/test-regression-verdict} — that answers "did THIS code change break a test in ONE run?", this
 * answers "is THIS scenario's delivery trending worse across the rail's run HISTORY?".
 */
import type { RailEvidenceReport } from "./rail-evidence";

/** Direction of a scenario's delivery rate across its run history (recent window vs. the earlier baseline window). */
export type DeliveryTrendDirection =
	/** The recent window delivers meaningfully MORE than the earlier baseline (delta ≥ `improveEpsilon`). Recovering. */
	| "improving"
	/** Recent and baseline delivery are within `[−improveEpsilon, +regressEpsilon)` of each other. Holding steady. */
	| "stable"
	/** The recent window delivers meaningfully LESS than the earlier baseline (delta ≤ `−regressEpsilon`). Sleeping issue. */
	| "regressing"
	/** Too few runs to split into two windows of `minWindowRuns` each — no direction can be claimed yet. */
	| "insufficient_data";

/** A scenario's delivery TREND, derived from its runs ordered oldest→newest and split into baseline vs. recent windows. */
export interface ScenarioDeliveryTrend {
	/** The scenario/preset label (`RailLaneEvidence.label`). */
	readonly project: string;
	readonly direction: DeliveryTrendDirection;
	/** Total runs observed for this scenario across the harvest. */
	readonly totalRuns: number;
	/** Runs in the earlier (baseline) window. 0 when `insufficient_data`. */
	readonly baselineRuns: number;
	/** Runs in the recent window. 0 when `insufficient_data`. */
	readonly recentRuns: number;
	/** delivered/runs in the baseline window (0 when it has no runs). */
	readonly baselineDeliveryRate: number;
	/** delivered/runs in the recent window (0 when it has no runs). */
	readonly recentDeliveryRate: number;
	/** `recentDeliveryRate − baselineDeliveryRate` (positive = recovering, negative = regressing). 0 when insufficient. */
	readonly delta: number;
	/**
	 * True when this scenario delivered in its baseline window (rate > 0) but delivers in NONE of its recent runs
	 * (recent rate === 0) — the sharpest "it used to work and now it doesn't" flag for the analysis pass to lead with.
	 */
	readonly newlyBroken: boolean;
	/** ISO `at` of the scenario's earliest observed run (from the input strings), or null if none had a parseable `at`. */
	readonly firstRunAt: string | null;
	/** ISO `at` of the scenario's latest observed run, or null if none had a parseable `at`. */
	readonly lastRunAt: string | null;
	/** Human-readable one-liner for the operator / rail "what's trending" surface. */
	readonly summary: string;
}

export interface RailDeliveryTrendReport {
	readonly totalReports: number;
	readonly totalRuns: number;
	/** Scenarios whose direction is `regressing` (a subset of `byProject`, same order) — the act-now set. */
	readonly regressingProjects: readonly string[];
	/** Scenarios whose direction is `newlyBroken` (delivered before, zero recent) — the sharpest subset of `regressing`. */
	readonly newlyBrokenProjects: readonly string[];
	/**
	 * Per-scenario trend, sorted MOST-CONCERNING-FIRST: newly-broken → regressing (by most-negative delta) → stable →
	 * improving → insufficient_data, ties broken by ascending `project` so the order is fully determined by the inputs.
	 */
	readonly byProject: readonly ScenarioDeliveryTrend[];
}

export interface ClassifyRailDeliveryTrendInput {
	/** The harvested rail reports (any order; each carries its own `at`/`model`/`lanes`). INJECTED — not read from disk. */
	readonly reports: readonly RailEvidenceReport[];
	/**
	 * Minimum runs required in EACH window (baseline + recent) before a direction can be claimed. Default 2. A scenario
	 * with fewer than `2 * minWindowRuns` total runs is `insufficient_data`. Non-finite / `< 1` values clamp to 1.
	 */
	readonly minWindowRuns?: number;
	/**
	 * Delivery-rate DROP (baseline → recent) at/beyond which the trend is `regressing`. Default 0.2 (a 20-point fall).
	 * Clamped to [0, 1]. A smaller epsilon flags gentler slides.
	 */
	readonly regressEpsilon?: number;
	/**
	 * Delivery-rate RISE at/beyond which the trend is `improving`. Default 0.2. Clamped to [0, 1]. Kept separate from
	 * `regressEpsilon` so the rail can be MORE eager to flag a regression than to celebrate an improvement (fail-safe).
	 */
	readonly improveEpsilon?: number;
}

const DIRECTION_ORDER: Record<DeliveryTrendDirection, number> = {
	regressing: 0,
	stable: 1,
	improving: 2,
	insufficient_data: 3,
};

interface DatedRun {
	/** Parsed epoch ms, or null when `at` was unparseable. */
	readonly time: number | null;
	/** Original position in the flattened run stream — the stable tiebreak when times are equal/absent. */
	readonly seq: number;
	readonly at: string;
	readonly delivered: boolean;
}

function clampUnit(value: number | undefined, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(1, Math.max(0, value));
}

/**
 * Order a scenario's runs oldest→newest. Runs with a parseable `at` sort by time; runs whose `at` is unparseable sort
 * AFTER all dated runs, each keeping its input order (`seq`) — so a missing timestamp never reorders the dated history
 * and never throws. Equal times fall back to `seq`, keeping the sort total + deterministic.
 */
function orderRunsChronologically(runs: readonly DatedRun[]): DatedRun[] {
	return [...runs].sort((left, right) => {
		if (left.time === null && right.time === null) {
			return left.seq - right.seq;
		}
		if (left.time === null) {
			return 1;
		}
		if (right.time === null) {
			return -1;
		}
		return left.time - right.time || left.seq - right.seq;
	});
}

function deliveryRate(runs: readonly DatedRun[]): number {
	if (runs.length === 0) {
		return 0;
	}
	const delivered = runs.reduce((count, run) => count + (run.delivered ? 1 : 0), 0);
	return delivered / runs.length;
}

function firstDatedAt(orderedOldestFirst: readonly DatedRun[]): string | null {
	for (const run of orderedOldestFirst) {
		if (run.time !== null) {
			return run.at;
		}
	}
	return null;
}

function lastDatedAt(orderedOldestFirst: readonly DatedRun[]): string | null {
	for (let index = orderedOldestFirst.length - 1; index >= 0; index -= 1) {
		const run = orderedOldestFirst[index];
		if (run.time !== null) {
			return run.at;
		}
	}
	return null;
}

/**
 * Classify each scenario's delivery TREND across the harvested rail reports (pure). For every scenario label seen in any
 * report's lanes: collect its runs (one per lane occurrence), order them oldest→newest by `at`, and split into a
 * baseline window (the earlier runs) and a recent window (the latest `minWindowRuns`). With fewer than `2*minWindowRuns`
 * runs → `insufficient_data`. Otherwise the direction is `regressing` when the recent rate falls by ≥ `regressEpsilon`,
 * `improving` when it rises by ≥ `improveEpsilon`, else `stable`. The result is sorted most-concerning-first so the
 * analysis pass leads with the freshest delivery regressions.
 */
export function classifyRailDeliveryTrend(input: ClassifyRailDeliveryTrendInput): RailDeliveryTrendReport {
	const minWindowRuns =
		typeof input.minWindowRuns === "number" && Number.isFinite(input.minWindowRuns)
			? Math.max(1, Math.floor(input.minWindowRuns))
			: 2;
	const regressEpsilon = clampUnit(input.regressEpsilon, 0.2);
	const improveEpsilon = clampUnit(input.improveEpsilon, 0.2);

	// Flatten reports → runs per scenario label, preserving a global sequence for stable ordering when times tie/absent.
	const runsByProject = new Map<string, DatedRun[]>();
	let seq = 0;
	let totalRuns = 0;
	for (const report of input.reports) {
		for (const lane of report.lanes) {
			const parsed = Date.parse(report.at);
			const run: DatedRun = {
				time: Number.isNaN(parsed) ? null : parsed,
				seq,
				at: report.at,
				delivered: lane.verdict === "delivered",
			};
			seq += 1;
			totalRuns += 1;
			const existing = runsByProject.get(lane.label);
			if (existing === undefined) {
				runsByProject.set(lane.label, [run]);
			} else {
				existing.push(run);
			}
		}
	}

	const trends: ScenarioDeliveryTrend[] = [];
	for (const [project, runs] of runsByProject) {
		const ordered = orderRunsChronologically(runs);
		const firstRunAt = firstDatedAt(ordered);
		const lastRunAt = lastDatedAt(ordered);

		if (ordered.length < minWindowRuns * 2) {
			trends.push({
				project,
				direction: "insufficient_data",
				totalRuns: ordered.length,
				baselineRuns: 0,
				recentRuns: 0,
				baselineDeliveryRate: 0,
				recentDeliveryRate: 0,
				delta: 0,
				newlyBroken: false,
				firstRunAt,
				lastRunAt,
				summary: `${project}: ${ordered.length} run(s) — not enough history to judge a trend (need ≥ ${
					minWindowRuns * 2
				}).`,
			});
			continue;
		}

		const recent = ordered.slice(ordered.length - minWindowRuns);
		const baseline = ordered.slice(0, ordered.length - minWindowRuns);
		const baselineRate = deliveryRate(baseline);
		const recentRate = deliveryRate(recent);
		const delta = recentRate - baselineRate;

		let direction: DeliveryTrendDirection;
		if (delta <= -regressEpsilon) {
			direction = "regressing";
		} else if (delta >= improveEpsilon) {
			direction = "improving";
		} else {
			direction = "stable";
		}
		const newlyBroken = direction === "regressing" && baselineRate > 0 && recentRate === 0;

		trends.push({
			project,
			direction,
			totalRuns: ordered.length,
			baselineRuns: baseline.length,
			recentRuns: recent.length,
			baselineDeliveryRate: baselineRate,
			recentDeliveryRate: recentRate,
			delta,
			newlyBroken,
			firstRunAt,
			lastRunAt,
			summary: formatTrendSummary(project, direction, baselineRate, recentRate, delta, newlyBroken),
		});
	}

	// Most-concerning-first: newly-broken outrank other regressions; within regressing, the biggest DROP (most-negative
	// delta) leads; then stable/improving/insufficient by DIRECTION_ORDER; every tie broken by ascending project name.
	trends.sort((left, right) => {
		if (left.newlyBroken !== right.newlyBroken) {
			return left.newlyBroken ? -1 : 1;
		}
		const byDirection = DIRECTION_ORDER[left.direction] - DIRECTION_ORDER[right.direction];
		if (byDirection !== 0) {
			return byDirection;
		}
		if (left.direction === "regressing" && left.delta !== right.delta) {
			return left.delta - right.delta;
		}
		return left.project.localeCompare(right.project);
	});

	const regressingProjects = trends.filter((trend) => trend.direction === "regressing").map((trend) => trend.project);
	const newlyBrokenProjects = trends.filter((trend) => trend.newlyBroken).map((trend) => trend.project);

	return {
		totalReports: input.reports.length,
		totalRuns,
		regressingProjects,
		newlyBrokenProjects,
		byProject: trends,
	};
}

function formatTrendSummary(
	project: string,
	direction: DeliveryTrendDirection,
	baselineRate: number,
	recentRate: number,
	delta: number,
	newlyBroken: boolean,
): string {
	const pct = (rate: number): string => `${Math.round(rate * 100)}%`;
	const move = `${pct(baselineRate)} → ${pct(recentRate)} (${delta >= 0 ? "+" : ""}${Math.round(delta * 100)} pts)`;
	switch (direction) {
		case "regressing":
			return newlyBroken
				? `${project}: NEWLY BROKEN — delivered before but no recent run delivers (${move}).`
				: `${project}: REGRESSING — delivery fell ${move}.`;
		case "improving":
			return `${project}: improving — delivery rose ${move}.`;
		case "stable":
			return `${project}: stable — delivery ${move}.`;
		case "insufficient_data":
			return `${project}: insufficient history for a trend.`;
	}
}
