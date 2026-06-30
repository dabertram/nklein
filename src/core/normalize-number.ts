/**
 * Numeric normalizers shared across config + agent modules (previously copy-pasted). Pure.
 *
 * `normalizePositiveNumber` keeps a value only when it is a finite number > 0, otherwise yields the caller's `fallback`
 * (or `null` when no fallback is given). The two overloads capture the two call styles the codebase used — a defaulting
 * form (`number`) and a nullable form (`number | null`) — over the ONE implementation.
 */
export function normalizePositiveNumber(value: unknown, fallback: number): number;
export function normalizePositiveNumber(value: unknown): number | null;
export function normalizePositiveNumber(value: unknown, fallback?: number): number | null {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return value;
	}
	return fallback ?? null;
}

/**
 * Keep a value as a positive INTEGER: truncate a finite number toward zero, then accept it only if the result is > 0.
 * Truncate-then-check is the correct order (the prior copies diverged — some checked `> 0` BEFORE truncating, so `0.5`
 * slipped through to a non-positive `0`; this rejects it). Yields `fallback` (or `null` when none) otherwise.
 */
export function normalizePositiveInteger(value: unknown, fallback: number): number;
export function normalizePositiveInteger(value: unknown): number | null;
export function normalizePositiveInteger(value: unknown, fallback?: number): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		const truncated = Math.trunc(value);
		if (truncated > 0) {
			return truncated;
		}
	}
	return fallback ?? null;
}

/**
 * Keep a value as a NON-NEGATIVE INTEGER: reject a negative input FIRST, then truncate (so a negative fraction like
 * `-0.5` is rejected rather than truncated to `0`). Yields `fallback` (or `null` when none) otherwise.
 */
export function normalizeNonNegativeInteger(value: unknown, fallback: number): number;
export function normalizeNonNegativeInteger(value: unknown): number | null;
export function normalizeNonNegativeInteger(value: unknown, fallback?: number): number | null {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
		return Math.trunc(value);
	}
	return fallback ?? null;
}
