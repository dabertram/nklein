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
