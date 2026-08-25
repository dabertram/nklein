import type { AdmissionPoolState } from "./durable-admission.js";

/**
 * F1.24 (§5.AF) — RESOURCE RESERVATIONS for dispatch: reserve what a card's session will consume BEFORE admission
 * (fast memory / context-KV bytes per device, endpoint capacity per pool, sandbox slots, disk budget) and release
 * on EVERY terminal/error path — closing the TOCTOU window between "the admission read said there was capacity"
 * and "the started session actually occupies it", where two same-tick dispatches could both see the same free slot.
 *
 * The ledger is deliberately GENERIC over `(kind, key)` counters so the five named resources share one accounting:
 *   - `endpoint_slot` / <poolKey>  — endpoint parallel-request capacity (units);
 *   - `sandbox_slot`  / "global"   — concurrent Docker sandboxes (units);
 *   - `kv_bytes`      / <deviceKey> — fast-memory / context-KV bytes on a device;
 *   - `disk_bytes`    / <deviceKey> — scratch/disk budget bytes.
 *
 * Semantics: `tryReserve` is ALL-OR-NOTHING (a partial grant would leak on the caller's error path) and
 * IDEMPOTENT per task (re-reserving replaces the task's prior holds — a retry never double-counts). `release` is
 * total and idempotent (releasing an unknown task is a no-op), so every terminal/error path can call it blindly.
 * {@link reservationAwarePools} folds the ledger's endpoint holds into the F1.19 admission pool view, so the
 * saturation planner sees in-flight-but-not-yet-occupying dispatches. Pure state machine; the caller owns time
 * and effects.
 *
 * ── 🔴 A LEAKED HOLD USED TO FREEZE THE RUNTIME PERMANENTLY (found 2026-08-01, F1.34c-drift's prime suspect,
 * confirmed by reading these seams) ──
 * The header above says holds are released "on EVERY terminal/error path". The wiring released on exactly two:
 * the task's first observed summary, and delivery. **A dispatch whose session died BEFORE producing any summary
 * never released**, `dispose` did not release, and there was no expiry — so the hold was permanent.
 *
 * And it was not harmless bookkeeping, despite the wiring's comment saying so. `tryReserve` fails OPEN on an
 * undeclared capacity (the grant succeeds) **but still records the hold**, `reserved()` counts it regardless of
 * whether a capacity was declared, and `reservationAwarePools` adds it to `inUse` UNCONDITIONALLY. So each leak
 * permanently shrank the pool the admission planner could see; enough of them and **nothing started again** —
 * matching the observed terminal shape exactly ("after the one worker-session failure, the runtime stops STARTING
 * sessions entirely; ready:1 NEVER starts").
 *
 * ── THE FIX IS AN EXPIRY, BECAUSE THE HOLD COVERS A BOUNDED WINDOW ──
 * This hold exists to cover dispatch → "the session shows in live occupancy", which is seconds. A hold outliving
 * that by minutes is leaked BY DEFINITION, whatever path failed to release it — so expiry fixes the whole class
 * rather than the one path that was found. **The failure directions are not symmetric:** expiring a still-live
 * hold re-opens a brief TOCTOU window that the runtime's own endpoint gates still catch downstream, while never
 * expiring freezes the board forever. Expiring is the recoverable direction.
 */

export type ReservationKind = "endpoint_slot" | "sandbox_slot" | "kv_bytes" | "disk_bytes";

export interface ReservationRequest {
	kind: ReservationKind;
	/** The pool/device the resource belongs to (poolKey, deviceKey, or "global"). */
	key: string;
	amount: number;
}

export interface ReservationCapacity {
	kind: ReservationKind;
	key: string;
	capacity: number;
}

export type ReserveOutcome =
	| { ok: true }
	| { ok: false; shortfall: { kind: ReservationKind; key: string; requested: number; available: number } };

export interface DispatchReservationLedger {
	/** All-or-nothing, per-task idempotent reservation. Unknown (kind,key) capacities are UNLIMITED (fail open). */
	tryReserve(taskId: string, requests: readonly ReservationRequest[]): ReserveOutcome;
	/** Release every hold the task has. Idempotent; safe on every terminal/error path. */
	release(taskId: string): void;
	/** Currently reserved amount for one counter. */
	reserved(kind: ReservationKind, key: string): number;
	/** Task ids currently holding reservations. */
	holders(): string[];
	/** Read-only cloned holds for operator telemetry; callers cannot mutate live accounting. */
	snapshot(): { taskId: string; requests: ReservationRequest[] }[];
}

/**
 * How long a dispatch hold may live before it is treated as leaked.
 *
 * OPERATIONAL DEFAULT, not measured. The window being covered is seconds; two minutes is generous enough that a
 * slow-but-live start on a throttling host keeps its hold, and short enough that a dead dispatch cannot wedge
 * admission for a whole drain.
 */
export const DEFAULT_RESERVATION_HOLD_TTL_MS = 120_000;

export interface DispatchReservationLedgerOptions {
	/** Holds older than this are dropped as leaked. Defaults to {@link DEFAULT_RESERVATION_HOLD_TTL_MS}. */
	readonly holdTtlMs?: number;
	/** Injected for tests; the ledger stays a pure state machine over whatever clock it is given. */
	readonly now?: () => number;
}

export function createDispatchReservationLedger(
	capacities: readonly ReservationCapacity[] = [],
	options: DispatchReservationLedgerOptions = {},
): DispatchReservationLedger {
	const capacityByCounter = new Map<string, number>();
	for (const capacity of capacities) {
		capacityByCounter.set(`${capacity.kind}\u0000${capacity.key}`, capacity.capacity);
	}
	const holdsByTask = new Map<string, ReservationRequest[]>();
	const reservedByCounter = new Map<string, number>();
	const takenAtByTask = new Map<string, number>();
	const holdTtlMs = options.holdTtlMs ?? DEFAULT_RESERVATION_HOLD_TTL_MS;
	const now = options.now ?? (() => Date.now());

	const counterKey = (kind: ReservationKind, key: string): string => `${kind}\u0000${key}`;
	const applyDelta = (requests: readonly ReservationRequest[], sign: 1 | -1): void => {
		for (const request of requests) {
			const key = counterKey(request.kind, request.key);
			const next = (reservedByCounter.get(key) ?? 0) + sign * request.amount;
			if (next <= 0) {
				reservedByCounter.delete(key);
			} else {
				reservedByCounter.set(key, next);
			}
		}
	};

	/**
	 * Drop holds older than the TTL. Called at the START of every operation, including the read-only ones.
	 *
	 * Lazy rather than timer-driven on purpose: this module is a pure state machine the caller drives, and a
	 * background timer would make its state depend on wall-clock arrival rather than on the calls made — which is
	 * exactly the kind of unmodelled time-dependence that made the 42-card drain irreproducible (N7d).
	 */
	const expireLeakedHolds = (): void => {
		const cutoff = now() - holdTtlMs;
		for (const [taskId, takenAt] of [...takenAtByTask.entries()]) {
			if (takenAt > cutoff) {
				continue;
			}
			const held = holdsByTask.get(taskId);
			if (held) {
				applyDelta(held, -1);
			}
			holdsByTask.delete(taskId);
			takenAtByTask.delete(taskId);
		}
	};

	return {
		tryReserve(taskId, requests) {
			expireLeakedHolds();
			// Audit 2026-08-25 (MEDIUM): a NaN/negative/non-integer `amount` used to slip through — `NaN > available`
			// is false, so it passed the capacity check and `applyDelta` then wrote NaN into the counter, poisoning
			// the admission pool until TTL expiry. Validate every request up front and refuse the whole call loudly
			// (all-or-nothing), rather than corrupt the ledger silently.
			for (const request of requests) {
				if (!Number.isInteger(request.amount) || request.amount <= 0) {
					return {
						ok: false,
						shortfall: {
							kind: request.kind,
							key: request.key,
							requested: request.amount,
							available: Number.NaN,
						},
					};
				}
			}
			// Idempotent per task: evaluate against the ledger WITHOUT the task's existing holds.
			const existing = holdsByTask.get(taskId);
			if (existing) {
				applyDelta(existing, -1);
			}
			for (const request of requests) {
				const key = counterKey(request.kind, request.key);
				const capacity = capacityByCounter.get(key);
				if (capacity === undefined) {
					continue; // no declared capacity — unlimited (fail open; the live gates still apply)
				}
				const available = capacity - (reservedByCounter.get(key) ?? 0);
				if (request.amount > available) {
					// All-or-nothing: restore the task's prior holds untouched.
					if (existing) {
						applyDelta(existing, 1);
					}
					return {
						ok: false,
						shortfall: { kind: request.kind, key: request.key, requested: request.amount, available },
					};
				}
			}
			applyDelta(requests, 1);
			holdsByTask.set(
				taskId,
				requests.map((request) => ({ ...request })),
			);
			// Re-reserving RESTARTS the clock: an idempotent re-reserve means the dispatch is still in flight.
			takenAtByTask.set(taskId, now());
			return { ok: true };
		},
		release(taskId) {
			takenAtByTask.delete(taskId);
			const holds = holdsByTask.get(taskId);
			if (!holds) {
				return;
			}
			holdsByTask.delete(taskId);
			applyDelta(holds, -1);
		},
		reserved(kind, key) {
			// Expire on READ too: `reservationAwarePools` folds this straight into the admission view, so a stale
			// hold would otherwise shrink the pool right up until the next write.
			expireLeakedHolds();
			return reservedByCounter.get(counterKey(kind, key)) ?? 0;
		},
		holders() {
			expireLeakedHolds();
			return [...holdsByTask.keys()];
		},
		snapshot() {
			expireLeakedHolds();
			return [...holdsByTask.entries()].map(([taskId, requests]) => ({
				taskId,
				requests: requests.map((request) => ({ ...request })),
			}));
		},
	};
}

/**
 * Fold the ledger's ENDPOINT holds into the F1.19 admission pool view: each pool's `inUse` gains the slots
 * reserved by dispatches that started but do not yet show in live occupancy — the saturation planner then sees
 * the true committed load. Pools with no reservations pass through unchanged.
 */
export function reservationAwarePools(
	pools: readonly AdmissionPoolState[],
	ledger: DispatchReservationLedger,
): AdmissionPoolState[] {
	return pools.map((pool) => ({
		...pool,
		inUse: pool.inUse + ledger.reserved("endpoint_slot", pool.poolKey),
	}));
}
