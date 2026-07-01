/**
 * The durable scheduler's READY-JOB PRIORITY / ORDERING policy — pure core (todo §5.AF; the C3 durable long-run
 * scheduler).
 *
 * WHAT: given the ready jobs of a durable run plus the full job graph (needed to see downstream dependents) and a small
 * amount of per-job scheduling metadata, this core produces a **deterministic order in which ready jobs should be
 * leased** when there are fewer free concurrency slots than ready jobs. It answers "of the jobs that COULD run right
 * now, which matter most, and in what order?" — with fully deterministic tie-breaks so a ledger replay reproduces the
 * same lease sequence.
 *
 * WHY: {@link module:core/durable-scheduler#decideDurableSchedulerActions} leases ready+eligible jobs in raw INPUT
 * ORDER, up to the free slots. That is correct and replay-stable, but it is arbitrary under contention: when the
 * concurrency cap is smaller than the ready set, whichever job happens to sit earlier in the array wins the slot,
 * regardless of how much downstream work it would unblock, how long it has already waited, or whether the operator
 * flagged it urgent. On a real multi-card DAG that starves the pipeline — a high-fan-out prerequisite left behind a
 * batch of leaf cards keeps every dependent BLOCKED while cheap independent leaves consume the workers. This core makes
 * the ordering a transparent, tested POLICY the scheduler (or its caller) can apply to the ready set before leasing.
 *
 * The score is a weighted sum of independent, purely-derivable SIGNALS so the policy lives in one place:
 *   critical-unblock (FAN-OUT) — how many not-yet-succeeded jobs directly depend on this job. Running a high-fan-out
 *                                prerequisite first unblocks the most downstream work fastest, keeping workers saturated.
 *                                Derived from the graph's `dependsOn` edges (a job's dependents), so it needs no extra
 *                                input beyond the jobs themselves.
 *   explicit priority          — a caller-supplied per-job priority (e.g. an operator-flagged merge/review job, or a
 *                                §5.AB routing hint). Higher = earlier. Optional; defaults to 0.
 *   starvation / retry age     — a job that has been reclaimed repeatedly (`attempts`) or has been ready a long time
 *                                (`readySince`, compared to the injected `now`) earns a BOUNDED anti-starvation boost so
 *                                it is not perpetually shed behind a stream of fresh, cheaper work.
 * Ties break deterministically: higher score → FEWER remaining dependencies (closer to a leaf of the *remaining* work,
 * so more likely to actually complete) → EARLIER `readySince` (FIFO fairness) → `jobId` ascending. The final `jobId`
 * key guarantees a total order, so the same inputs always yield the same sequence (replay-stable, §5.AF).
 *
 * Pure + deterministic (no fs/network/model/db; the clock is INJECTED as `now`): the order is a property of the inputs
 * alone. This module ONLY orders the ready candidates — it does not decide leases, eligibility (backoff), reclaim, or
 * failure; those remain {@link module:core/durable-scheduler}'s job. A caller uses this to pick WHICH ready jobs to fill
 * the free slots with when it cannot lease them all at once. Orthogonal to
 * {@link module:core/test-selection-priority} (that prioritizes TESTS for the §5.AI rail; this prioritizes durable
 * JOBS for the §5.AF scheduler).
 */

import type { DurableJob } from "./durable-scheduler";

/** Optional, INJECTED per-job scheduling metadata keyed by `jobId`. Every field is optional; absent ⇒ a neutral default. */
export interface ReadyJobSchedulingMeta {
	/**
	 * Caller-supplied explicit priority (higher = should run earlier), e.g. an operator-flagged merge/review job or a
	 * §5.AB routing hint. Multiplied by {@link ReadyOrderWeights.explicitPriority} and added. Non-finite ⇒ 0.
	 */
	readonly priority?: number;
	/**
	 * Epoch ms at which this job first became `ready` (entered the lease queue). Used ONLY for the starvation boost and
	 * the FIFO tie-break — a smaller value is older. Absent ⇒ treated as "just became ready" (no age boost, sorts last on
	 * the age tie-break). INJECTED so the core stays clock-free.
	 */
	readonly readySince?: number;
}

/** Tunable signal weights (all default to sensible values). A caller may override to re-shape the policy. */
export interface ReadyOrderWeights {
	/** Added per not-yet-succeeded downstream dependent (fan-out). The dominant signal by default. Default 40. */
	readonly fanOut?: number;
	/** Max fan-out that still contributes (so one hub job can't infinitely dominate the sum). Default 8. */
	readonly fanOutCap?: number;
	/** Multiplied by the injected per-job `priority` and added. Default 25. */
	readonly explicitPriority?: number;
	/** Added per prior attempt (a reclaimed/retried job), capped by `attemptCap` — a bounded anti-starvation boost. Default 15. */
	readonly attempt?: number;
	/** Max prior-attempt count that still contributes to the starvation boost. Default 4. */
	readonly attemptCap?: number;
	/**
	 * Added when a job has waited at least `ageBoostAfterMs` since it became ready — a BOUNDED, single-step anti-starvation
	 * boost (not a runaway linear ramp, so a long-idle queue doesn't invert the whole policy). Default 30.
	 */
	readonly agedBoost?: number;
	/** How long (ms) a ready job must have waited before it earns `agedBoost`. Default 60000 (1 min). */
	readonly ageBoostAfterMs?: number;
}

/** Which independent signals fired for a job (for the operator "why this order" surface). */
export interface ReadyOrderSignals {
	/** Fan-out (not-yet-succeeded downstream dependents) counted for this job, capped by `fanOutCap`. */
	readonly fanOut: number;
	/** True when the job carried a positive explicit `priority`. */
	readonly prioritized: boolean;
	/** Prior-attempt count counted for the starvation boost, capped by `attemptCap`. */
	readonly attempts: number;
	/** True when the job had been ready at least `ageBoostAfterMs` (earned the aged boost). */
	readonly aged: boolean;
}

/** One scored + ordered ready job. */
export interface OrderedReadyJob {
	readonly jobId: string;
	/** The weighted-sum score (higher = lease earlier). Deterministic given the inputs. */
	readonly score: number;
	/** Count of this job's dependencies that have NOT yet succeeded — the "remaining depth" tie-break key (fewer = earlier). */
	readonly remainingDeps: number;
	/** The `readySince` used for the FIFO tie-break (`null` when unknown → sorts last among equals). */
	readonly readySince: number | null;
	/** The signals that contributed, for explanation. */
	readonly signals: ReadyOrderSignals;
	/** Human-readable one-liner naming the signals that ranked this job. */
	readonly reason: string;
}

export interface OrderReadyJobsInput {
	/**
	 * The full durable job graph. Fan-out (downstream dependents) and remaining-dependency counts are computed against
	 * this whole set, not just the ready subset — a ready job's importance is a function of the jobs waiting on it. INJECTED.
	 */
	readonly jobs: readonly DurableJob[];
	/** Current clock (epoch ms). Passed in so the core stays pure + replay-deterministic. Drives only the aged boost. */
	readonly now: number;
	/** Optional per-job scheduling metadata keyed by `jobId`. Absent entries use neutral defaults. */
	readonly meta?: Readonly<Record<string, ReadyJobSchedulingMeta>>;
	/** Optional weight overrides. */
	readonly weights?: ReadyOrderWeights;
	/**
	 * Cap the returned order to at most this many highest-priority ready jobs (e.g. the number of FREE concurrency slots
	 * this tick). Non-finite / `< 0` ⇒ ignored (order ALL ready jobs). `0` ⇒ empty (no slots).
	 */
	readonly limit?: number;
}

export interface ReadyOrderResult {
	/** ALL ready jobs in priority order (highest score first; deterministic tie-breaks). */
	readonly ordered: readonly OrderedReadyJob[];
	/** The highest-priority prefix to lease this tick, honouring `limit` (all of `ordered` when `limit` is unset). */
	readonly selected: readonly OrderedReadyJob[];
	readonly counts: {
		/** Ready jobs considered (the size of `ordered`). */
		readonly ready: number;
		readonly selected: number;
		/** Ready jobs that had ≥1 not-yet-succeeded downstream dependent. */
		readonly withDependents: number;
		/** Ready jobs that carried a positive explicit priority. */
		readonly prioritized: number;
		/** Ready jobs that earned the aged starvation boost. */
		readonly aged: number;
	};
	/** Human-readable one-liner for the scheduler "what will lease next + why" surface. */
	readonly summary: string;
}

const DEFAULT_WEIGHTS: Required<ReadyOrderWeights> = {
	fanOut: 40,
	fanOutCap: 8,
	explicitPriority: 25,
	attempt: 15,
	attemptCap: 4,
	agedBoost: 30,
	ageBoostAfterMs: 60_000,
};

/** A finite value, else the fallback. */
function finiteOr(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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
	return Math.floor(value);
}

/**
 * Order the ready jobs of a durable run for leasing (pure). Each ready job's score is a weighted sum of independent
 * signals — downstream FAN-OUT (how much work it unblocks), an explicit caller priority, and a BOUNDED anti-starvation
 * boost (prior attempts + waited-too-long) — and the order is highest-score-first, breaking ties toward FEWER remaining
 * dependencies, then EARLIER `readySince` (FIFO), then `jobId` ascending, for a fully deterministic (replay-stable)
 * total order. `selected` is the highest-priority prefix that fits under `limit` (the free concurrency slots), or all of
 * `ordered` when `limit` is unset.
 *
 * Only `ready` jobs are ordered; every other state is ignored here (leasing eligibility — backoff, dependency success,
 * concurrency — remains {@link module:core/durable-scheduler}'s decision). Fan-out and remaining-dependency counts are
 * computed against the WHOLE `jobs` graph, and count only dependents/dependencies that have NOT yet `succeeded` (a
 * dependent already done adds no unblock value; a dependency already done no longer gates). A duplicate `jobId` in
 * `jobs` uses the LAST occurrence's fields for that job's own row, but every listed edge still contributes to fan-out.
 */
export function orderReadyJobs(input: OrderReadyJobsInput): ReadyOrderResult {
	const weights: Required<ReadyOrderWeights> = {
		fanOut: finiteOr(input.weights?.fanOut, DEFAULT_WEIGHTS.fanOut),
		fanOutCap: Math.max(0, Math.floor(finiteOr(input.weights?.fanOutCap, DEFAULT_WEIGHTS.fanOutCap))),
		explicitPriority: finiteOr(input.weights?.explicitPriority, DEFAULT_WEIGHTS.explicitPriority),
		attempt: finiteOr(input.weights?.attempt, DEFAULT_WEIGHTS.attempt),
		attemptCap: Math.max(0, Math.floor(finiteOr(input.weights?.attemptCap, DEFAULT_WEIGHTS.attemptCap))),
		agedBoost: finiteOr(input.weights?.agedBoost, DEFAULT_WEIGHTS.agedBoost),
		ageBoostAfterMs: Math.max(0, finiteOr(input.weights?.ageBoostAfterMs, DEFAULT_WEIGHTS.ageBoostAfterMs)),
	};

	// Index the graph once. `succeeded` gates the fan-out / remaining-dep counts; `dependentCount` maps a prerequisite
	// job id → how many NOT-yet-succeeded jobs list it in their `dependsOn` (its downstream unblock value).
	const succeeded = new Set<string>();
	for (const job of input.jobs) {
		if (job.state === "succeeded") {
			succeeded.add(job.jobId);
		}
	}
	const dependentCount = new Map<string, number>();
	for (const job of input.jobs) {
		if (job.state === "succeeded") {
			continue; // an already-done dependent contributes no unblock value to its prerequisites
		}
		for (const depId of job.dependsOn) {
			dependentCount.set(depId, (dependentCount.get(depId) ?? 0) + 1);
		}
	}

	// Dedup ready jobs by id (last write wins) so a re-listed job is scored once.
	const readyById = new Map<string, DurableJob>();
	for (const job of input.jobs) {
		if (job.state === "ready") {
			readyById.set(job.jobId, job);
		}
	}

	const ordered: OrderedReadyJob[] = [];
	for (const job of readyById.values()) {
		const meta = input.meta?.[job.jobId];
		const rawFanOut = dependentCount.get(job.jobId) ?? 0;
		const fanOut = Math.min(rawFanOut, weights.fanOutCap);
		const remainingDeps = job.dependsOn.filter((depId) => !succeeded.has(depId)).length;

		const priority = finiteOr(meta?.priority, 0);
		const prioritized = priority > 0;
		const attempts = Math.min(nonNegativeCount(job.attempts), weights.attemptCap);

		const readySince =
			typeof meta?.readySince === "number" && Number.isFinite(meta.readySince) ? meta.readySince : null;
		const aged =
			readySince !== null && Number.isFinite(input.now) && input.now - readySince >= weights.ageBoostAfterMs;

		let score = 0;
		score += fanOut * weights.fanOut;
		score += priority * weights.explicitPriority;
		score += attempts * weights.attempt;
		if (aged) {
			score += weights.agedBoost;
		}

		ordered.push({
			jobId: job.jobId,
			score,
			remainingDeps,
			readySince,
			signals: { fanOut, prioritized, attempts, aged },
			reason: formatReason({ fanOut, prioritized, attempts, aged }, priority),
		});
	}

	ordered.sort(compareByReadyPriority);

	const limit = optionalBound(input.limit);
	const selected = limit === undefined ? ordered : ordered.slice(0, limit);

	const counts = {
		ready: ordered.length,
		selected: selected.length,
		withDependents: ordered.filter((job) => job.signals.fanOut > 0).length,
		prioritized: ordered.filter((job) => job.signals.prioritized).length,
		aged: ordered.filter((job) => job.signals.aged).length,
	};

	return { ordered, selected, counts, summary: formatSummary(counts) };
}

/**
 * Higher score first; then FEWER remaining dependencies (closer to completing); then EARLIER `readySince` (FIFO; unknown
 * sorts last); then `jobId` ascending. Fully deterministic — the trailing `jobId` key guarantees a total order.
 */
function compareByReadyPriority(left: OrderedReadyJob, right: OrderedReadyJob): number {
	if (left.score !== right.score) {
		return right.score - left.score;
	}
	if (left.remainingDeps !== right.remainingDeps) {
		return left.remainingDeps - right.remainingDeps;
	}
	const leftAge = left.readySince ?? Number.POSITIVE_INFINITY;
	const rightAge = right.readySince ?? Number.POSITIVE_INFINITY;
	if (leftAge !== rightAge) {
		return leftAge - rightAge;
	}
	return left.jobId.localeCompare(right.jobId);
}

function formatReason(signals: ReadyOrderSignals, priority: number): string {
	const parts: string[] = [];
	if (signals.fanOut > 0) {
		parts.push(`unblocks ${signals.fanOut} dependent(s)`);
	}
	if (signals.prioritized) {
		parts.push(`priority ${priority}`);
	}
	if (signals.attempts > 0) {
		parts.push(`retried x${signals.attempts}`);
	}
	if (signals.aged) {
		parts.push("waited long (aged)");
	}
	return parts.length > 0 ? parts.join("; ") : "no priority signal";
}

function formatSummary(counts: ReadyOrderResult["counts"]): string {
	if (counts.ready === 0) {
		return "No ready jobs to order.";
	}
	return (
		`Lease ${counts.selected}/${counts.ready} ready job(s) next: ` +
		`${counts.withDependents} unblock work, ${counts.prioritized} prioritized` +
		`${counts.aged > 0 ? `, ${counts.aged} aged (anti-starvation)` : ""}.`
	);
}
