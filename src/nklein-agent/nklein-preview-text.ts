/**
 * Pure preview-text helpers, extracted from nklein-event-adapter.
 *
 * Turn raw agent output / streamed chunks into a compact single-line preview for task summaries and
 * hook-activity stamps: collapse all whitespace runs to single spaces and trim, then optionally cap
 * the length with an ellipsis.
 */

/** Collapse whitespace runs to single spaces and trim; empty becomes null. Non-strings become null. */
export function normalizePreviewText(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized || null;
}

/**
 * {@link normalizePreviewText} capped at `maxLength` (default 160): a longer string is cut to
 * `maxLength - 1` chars (trailing space trimmed) plus a single-char `…`, so the result never exceeds
 * `maxLength`. Returns null for empty/normalized-empty input.
 */
export function toPreviewText(value: string | null | undefined, maxLength = 160): string | null {
	const normalized = normalizePreviewText(value);
	if (!normalized) {
		return null;
	}
	return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}…` : normalized;
}
