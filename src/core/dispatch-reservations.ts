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

export function createDispatchReservationLedger(
	capacities: readonly ReservationCapacity[] = [],
): DispatchReservationLedger {
	const capacityByCounter = new Map<string, number>();
	for (const capacity of capacities) {
		capacityByCounter.set(`${capacity.kind}\u0000${capacity.key}`, capacity.capacity);
	}
	const holdsByTask = new Map<string, ReservationRequest[]>();
	const reservedByCounter = new Map<string, number>();

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

	return {
		tryReserve(taskId, requests) {
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
			return { ok: true };
		},
		release(taskId) {
			const holds = holdsByTask.get(taskId);
			if (!holds) {
				return;
			}
			holdsByTask.delete(taskId);
			applyDelta(holds, -1);
		},
		reserved(kind, key) {
			return reservedByCounter.get(counterKey(kind, key)) ?? 0;
		},
		holders() {
			return [...holdsByTask.keys()];
		},
		snapshot() {
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
