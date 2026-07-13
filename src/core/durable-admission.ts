/**
 * F1.19 (§5.AF) — SATURATION-AWARE durable admission: which ready jobs a scheduling wake should consider, given
 * the live endpoint/pool occupancy, with FAIRNESS across pools and a STARVATION BOUND — plus the event-driven
 * wake coordinator that replaces retry polling.
 *
 *  - **saturation** — a job whose pool has no free capacity is EXCLUDED this wake (it can't start anyway; leasing
 *    it would burn a lease attempt against a busy endpoint — exactly the retry-polling waste this replaces);
 *  - **fairness** — admissible candidates interleave ROUND-ROBIN across pools (longest-waiting first within each
 *    pool), so one hot pool with many ready jobs cannot monopolize the run's concurrency slots;
 *  - **starvation bound** — a candidate waiting past the bound jumps to the FRONT (longest-waiting first, across
 *    pools) and is surfaced in `starvingJobIds`, so an unlucky job always wins the next slot its pool frees;
 *  - **event-driven wakes** — {@link createAdmissionWakeCoordinator}: capacity-freed / job-ready events request an
 *    immediate (debounced) tick instead of waiting for the interval, which remains only the fallback heartbeat.
 *
 * Pure + total: unknown pools count as unpooled (always admissible — fail open, the scheduler's other gates still
 * apply); a pool with capacity ≤ 0 admits nothing from that pool.
 */

export interface AdmissionPoolState {
	poolKey: string;
	/** Concurrent starts this pool can hold (e.g. the endpoint's parallel-request capacity). */
	capacity: number;
	/** Starts currently occupying it (running/leased sessions on this pool). */
	inUse: number;
}

export interface AdmissionCandidate {
	jobId: string;
	/** The endpoint/pool this job would start on; null = unpooled (always admissible). */
	poolKey: string | null;
	/** When the job became ready (epoch ms) — the waiting-age basis for fairness + starvation. */
	readySinceMs: number;
}

export interface DurableAdmissionPlan {
	/** The admissible candidates, fairness-ordered (starving first, then round-robin across pools). */
	readyOrder: string[];
	/** Candidates excluded THIS wake because their pool is saturated. */
	excludedJobIds: string[];
	/** Candidates waiting past the starvation bound (admissible ones lead readyOrder; saturated ones are flagged). */
	starvingJobIds: string[];
}

export const DEFAULT_ADMISSION_STARVATION_BOUND_MS = 600_000;

export interface DurableAdmissionInput {
	candidates: readonly AdmissionCandidate[];
	pools: readonly AdmissionPoolState[];
	now: number;
	starvationBoundMs?: number;
}

/** Plan one admission wake. Pure + deterministic (stable order for equal ages: input order). */
export function planDurableAdmission(input: DurableAdmissionInput): DurableAdmissionPlan {
	const bound = input.starvationBoundMs ?? DEFAULT_ADMISSION_STARVATION_BOUND_MS;
	const freeByPool = new Map<string, number>();
	for (const pool of input.pools) {
		freeByPool.set(pool.poolKey, Math.max(0, pool.capacity - pool.inUse));
	}

	const excludedJobIds: string[] = [];
	const starvingJobIds: string[] = [];
	const admissibleByPool = new Map<string, AdmissionCandidate[]>();
	const starvingAdmissible: AdmissionCandidate[] = [];

	for (const candidate of input.candidates) {
		const starving = input.now - candidate.readySinceMs >= bound;
		if (starving) {
			starvingJobIds.push(candidate.jobId);
		}
		const free =
			candidate.poolKey === null
				? Number.POSITIVE_INFINITY
				: (freeByPool.get(candidate.poolKey) ?? Number.POSITIVE_INFINITY);
		if (free <= 0) {
			excludedJobIds.push(candidate.jobId);
			continue;
		}
		if (starving) {
			starvingAdmissible.push(candidate);
			continue;
		}
		const key = candidate.poolKey ?? "";
		const list = admissibleByPool.get(key) ?? [];
		list.push(candidate);
		admissibleByPool.set(key, list);
	}

	// Starving admissible candidates lead, longest-waiting first.
	starvingAdmissible.sort((left, right) => left.readySinceMs - right.readySinceMs);

	// Fairness: longest-waiting first WITHIN each pool, then round-robin ACROSS pools (pool order = first appearance).
	for (const list of admissibleByPool.values()) {
		list.sort((left, right) => left.readySinceMs - right.readySinceMs);
	}
	const interleaved: AdmissionCandidate[] = [];
	const lists = [...admissibleByPool.values()];
	for (let index = 0; lists.some((list) => index < list.length); index += 1) {
		for (const list of lists) {
			const candidate = list[index];
			if (candidate) {
				interleaved.push(candidate);
			}
		}
	}

	return {
		readyOrder: [...starvingAdmissible, ...interleaved].map((candidate) => candidate.jobId),
		excludedJobIds,
		starvingJobIds,
	};
}

export interface AdmissionWakeCoordinatorOptions {
	/** Run one scheduling tick NOW (the controller's tick; failures are the tick's own concern). */
	requestTick: () => void | Promise<void>;
	/** Coalesce a burst of events into one tick within this window (ms; default 50). */
	debounceMs?: number;
	setTimer?: (callback: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
}

export interface AdmissionWakeCoordinator {
	/** A pool freed capacity (a session finished / a model unloaded) — wake the scheduler now. */
	capacityFreed(poolKey?: string): void;
	/** A job became ready (dependency released / backoff elapsed) — wake the scheduler now. */
	jobBecameReady(): void;
	dispose(): void;
}

/**
 * The event-driven wake: capacity-freed / job-ready events request ONE debounced tick instead of each poll
 * interval discovering the change late. The interval timer stays as the fallback heartbeat only.
 */
export function createAdmissionWakeCoordinator(options: AdmissionWakeCoordinatorOptions): AdmissionWakeCoordinator {
	const debounceMs = options.debounceMs ?? 50;
	const setTimer = options.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
	const clearTimer =
		options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
	let pending: unknown = null;
	let disposed = false;

	const wake = (): void => {
		if (disposed || pending !== null) {
			return; // a tick is already scheduled for this burst
		}
		pending = setTimer(() => {
			pending = null;
			if (!disposed) {
				void options.requestTick();
			}
		}, debounceMs);
	};

	return {
		capacityFreed: () => wake(),
		jobBecameReady: () => wake(),
		dispose: () => {
			disposed = true;
			if (pending !== null) {
				clearTimer(pending);
				pending = null;
			}
		},
	};
}
