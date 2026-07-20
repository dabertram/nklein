/**
 * N6 — nightly scheduling: go faster WITHOUT weakening coverage. PURE core.
 *
 * Every speed-up available here is also a way to quietly test less, and the two are hard to tell apart from a
 * green run. Reordering, batching and parallelism all preserve the *appearance* of a full suite while changing
 * what actually executed. So coverage preservation is not a nice property of this module — it is the thing it
 * mainly exists to guarantee, and `planNightlySchedule` REFUSES to return a plan that drops or duplicates a cell.
 *
 * ── THE ONE PIECE OF FIELD KNOWLEDGE THIS ENCODES ──
 * Running the dev-test projects in parallel batches makes **the two largest false-timeout** — they pass
 * sequentially and fail under contention. That is the worst possible failure shape: it is not a crash, it is a
 * FALSE RED that looks exactly like a real regression, and chasing it burns a morning before anyone remembers the
 * cause. A false red also trains people to re-run rather than investigate, which is how a real red gets ignored
 * later. So heavy cells are pinned sequential, and that is a correctness constraint, not a tuning preference.
 *
 * ── ORDER: FASTEST FIRST, FOR SIGNAL, NOT FOR THROUGHPUT ──
 * Fastest-first does not finish the suite sooner — the total is the same work. It surfaces the first failure
 * sooner, which is what matters for a suite whose results are read the next morning: knowing at minute 4 that
 * something broke is worth more than knowing at hour 3.
 *
 * ── SELF-REGRESSION: THE SUITE MUST WATCH ITS OWN COST ──
 * A cell that silently drifts from 40s to 200s is a regression in the product, but it presents as "the nightly
 * got slower" and is usually absorbed rather than investigated. `detectDurationRegressions` names it, and requires
 * a MINIMUM ABSOLUTE delta as well as a ratio — without that, a 0.2s cell becoming 0.7s reports as a 3.5×
 * regression and the report fills with noise nobody reads, which is how a real 5× gets missed.
 */

export interface NightlyCell {
	readonly id: string;
	/** Observed wall time from previous runs, ms. Null when this cell has never run. */
	readonly lastDurationMs: number | null;
	/** Cells known to false-timeout under contention. Pinned sequential regardless of anything else. */
	readonly heavy?: boolean;
}

export interface ScheduledGroup {
	/** Cells in this group may run concurrently. A single-element group is effectively sequential. */
	readonly cells: readonly string[];
	readonly sequential: boolean;
	readonly reason: string;
}

export interface SchedulePlan {
	readonly groups: readonly ScheduledGroup[];
	/** Every cell id in the plan, for the coverage assertion. */
	readonly scheduledCells: readonly string[];
	readonly summary: string;
}

export class CoverageWeakenedError extends Error {}

/**
 * Plan the run order.
 *
 * Throws `CoverageWeakenedError` rather than returning a degraded plan. A scheduler that silently drops a cell
 * produces a green run over a smaller suite — the single most misleading outcome available here, and one that no
 * downstream check would catch, because every cell it DID run passed.
 */
export function planNightlySchedule(input: {
	readonly cells: readonly NightlyCell[];
	readonly maxParallel?: number;
}): SchedulePlan {
	const maxParallel = Math.max(1, Math.trunc(input.maxParallel ?? 1));

	const seen = new Set<string>();
	for (const cell of input.cells) {
		if (seen.has(cell.id)) {
			throw new CoverageWeakenedError(`duplicate cell id "${cell.id}" — a cell would run twice and mask a peer`);
		}
		seen.add(cell.id);
	}

	// Unmeasured cells sort LAST among the parallel-safe ones, not first: an unknown duration could be the longest
	// in the suite, and putting it early would defeat the fastest-first signal it is supposed to serve.
	const rank = (cell: NightlyCell) => cell.lastDurationMs ?? Number.POSITIVE_INFINITY;
	const heavy = input.cells.filter((cell) => cell.heavy === true).sort((a, b) => rank(a) - rank(b));
	const light = input.cells.filter((cell) => cell.heavy !== true).sort((a, b) => rank(a) - rank(b));

	const groups: ScheduledGroup[] = [];
	for (let index = 0; index < light.length; index += maxParallel) {
		const batch = light.slice(index, index + maxParallel);
		groups.push({
			cells: batch.map((cell) => cell.id),
			sequential: batch.length === 1,
			reason:
				maxParallel === 1
					? "sequential (no parallelism requested)"
					: `parallel batch of ${batch.length}, fastest-first for early failure signal`,
		});
	}
	for (const cell of heavy) {
		groups.push({
			cells: [cell.id],
			sequential: true,
			reason: "HEAVY: false-timeouts under contention — a false red costs more than the time parallelism saves",
		});
	}

	const scheduledCells = groups.flatMap((group) => group.cells);
	if (scheduledCells.length !== input.cells.length) {
		throw new CoverageWeakenedError(
			`plan covers ${scheduledCells.length} of ${input.cells.length} cell(s) — refusing to run a smaller suite that would report green`,
		);
	}

	return {
		groups,
		scheduledCells,
		summary: `${input.cells.length} cell(s) in ${groups.length} group(s); ${heavy.length} pinned sequential as heavy; max parallelism ${maxParallel}.`,
	};
}

export interface DurationRegression {
	readonly cellId: string;
	readonly baselineMs: number;
	readonly currentMs: number;
	readonly ratio: number;
	readonly detail: string;
}

/** Below this absolute increase a ratio is noise, however large it looks. */
export const MIN_REGRESSION_DELTA_MS = 5_000;
/** Slowdown factor that counts as a regression once the absolute delta clears the floor. */
export const REGRESSION_RATIO = 3;

/**
 * Find cells that got materially slower.
 *
 * Requires BOTH the ratio and the absolute floor. Ratio alone floods the report with sub-second cells and the
 * report stops being read; absolute alone misses a fast cell degrading badly. Reporting nothing is the correct
 * output for a cell with no baseline — a first observation is not a comparison, and calling it one would
 * manufacture a regression on every newly-added cell.
 */
export function detectDurationRegressions(
	observations: readonly { cellId: string; baselineMs: number | null; currentMs: number }[],
	options: { ratio?: number; minDeltaMs?: number } = {},
): readonly DurationRegression[] {
	const ratioBar = options.ratio ?? REGRESSION_RATIO;
	const deltaBar = options.minDeltaMs ?? MIN_REGRESSION_DELTA_MS;

	const regressions: DurationRegression[] = [];
	for (const observation of observations) {
		const baseline = observation.baselineMs;
		if (baseline === null || baseline <= 0) {
			continue;
		}
		const delta = observation.currentMs - baseline;
		const ratio = observation.currentMs / baseline;
		if (ratio >= ratioBar && delta >= deltaBar) {
			regressions.push({
				cellId: observation.cellId,
				baselineMs: baseline,
				currentMs: observation.currentMs,
				ratio,
				detail: `${observation.cellId}: ${Math.round(baseline)}ms → ${Math.round(observation.currentMs)}ms (${ratio.toFixed(1)}×, +${Math.round(delta)}ms) — the suite getting slower is usually absorbed rather than investigated; this is the product regressing`,
			});
		}
	}
	return regressions.sort((left, right) => right.ratio - left.ratio);
}
