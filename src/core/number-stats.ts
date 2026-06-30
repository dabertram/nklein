/**
 * Tiny pure numeric statistics, extracted from agent-attempt-ledger. Both return null for an empty
 * input (so callers report "no samples" rather than a misleading 0). Behavior-preserving.
 */

/** Arithmetic mean of a numeric list, or null when empty. */
export function meanOrNull(values: readonly number[]): number | null {
	return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** Median of a numeric list (lower-of-two for even counts), or null when empty. */
export function medianOrNull(values: readonly number[]): number | null {
	if (values.length === 0) {
		return null;
	}
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
}
