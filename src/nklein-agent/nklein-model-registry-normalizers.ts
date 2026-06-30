/**
 * Pure field-value normalizers for model-registry deserialization, extracted from
 * nklein-model-registry. Each coerces an untrusted persisted value into a valid field value or null,
 * clamping to the field's domain. No registry state, so behavior-preserving and unit-testable.
 */

/** A capability-style score: a finite number clamped to [0, 100], else null. */
export function normalizeScore(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	return Math.max(0, Math.min(100, value));
}

/** A trimmed non-empty string, else null. */
export function normalizeNullableString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/** A non-negative finite number (an unclamped score-like value), else null. */
export function normalizeScoreLikeNumber(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return null;
	}
	return value;
}

/** A pass rate: a finite number in [0, 1], else null. */
export function normalizePassRate(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
		return null;
	}
	return value;
}
