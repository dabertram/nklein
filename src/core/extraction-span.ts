/**
 * Extraction-span extractor for the §5.AC retrieval loop — "extract" step.
 *
 * After fetching a document we do NOT feed the whole page to synthesis.  Instead we extract only
 * the character windows around query-term matches and hand those spans to the synthesis step.  This
 * keeps context-window consumption proportional to relevance and removes noise from unrelated parts
 * of the document.
 *
 * Pipeline position:
 *   fetch → **extractRelevantSpans** → RetrievedEvidence.extractionSpans → synthesis
 *
 * This module is pure logic: no LLM, no network, no side-effects, no mutation of inputs.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single extracted window from a source document. */
export interface ExtractionSpan {
	/** Inclusive start offset in the original text (character index). */
	start: number;
	/** Exclusive end offset in the original text (character index). */
	end: number;
	/** Verbatim slice of the original text: `text.slice(start, end)`. */
	text: string;
}

/** Options controlling the extractor's window size and result cap. */
export interface ExtractionOptions {
	/**
	 * Number of characters to include on each side of a match.
	 * Defaults to `120`.
	 */
	windowChars?: number;
	/**
	 * Maximum number of merged spans to return.  When there are more merged windows than this cap
	 * the extractor keeps the earliest ones (smallest `start`).
	 * Defaults to `5`.
	 */
	maxSpans?: number;
}

// ---------------------------------------------------------------------------
// Core extractor
// ---------------------------------------------------------------------------

/**
 * Extract character windows around the first occurrence of each query term in `text`.
 *
 * Algorithm:
 * 1. Normalise: lowercase a copy of `text` and each query term.  Skip blank/whitespace-only terms.
 * 2. For each remaining term, find its **first** occurrence via `indexOf` on the lowercased text.
 *    If found, form a raw window `[start, end)`:
 *      - `start = max(0, idx - floor(windowChars / 2))`
 *      - `end   = min(text.length, idx + term.length + floor(windowChars / 2))`
 * 3. Sort all raw windows by `start` ascending.
 * 4. Merge: if the next window's `start <= current.end` extend `current.end`.
 * 5. Cap to the first `maxSpans` merged windows.
 * 6. Build result: `{ start, end, text: text.slice(start, end) }` from the **original-case** text.
 *
 * Returns `[]` when `queryTerms` is empty, all terms are whitespace-only, or no term is found.
 *
 * @param text       The source document to search.
 * @param queryTerms Terms to search for (case-insensitive substring match).
 * @param options    Optional window/cap overrides.
 */
export function extractRelevantSpans(
	text: string,
	queryTerms: readonly string[],
	options?: ExtractionOptions,
): ExtractionSpan[] {
	const windowChars = options?.windowChars ?? 120;
	const maxSpans = options?.maxSpans ?? 5;
	const half = Math.floor(windowChars / 2);

	const lowerText = text.toLowerCase();

	// Step 1 + 2: collect raw windows, one per term (first match only).
	const raw: Array<{ start: number; end: number }> = [];

	for (const term of queryTerms) {
		const lowerTerm = term.toLowerCase();
		// Skip blank/whitespace-only terms.
		if (lowerTerm.trim().length === 0) {
			continue;
		}

		const idx = lowerText.indexOf(lowerTerm);
		if (idx === -1) {
			continue;
		}

		const start = Math.max(0, idx - half);
		const end = Math.min(text.length, idx + lowerTerm.length + half);
		raw.push({ start, end });
	}

	if (raw.length === 0) {
		return [];
	}

	// Step 3: sort by start ascending.
	raw.sort((a, b) => a.start - b.start);

	// Step 4: merge overlapping or touching windows.
	const merged: Array<{ start: number; end: number }> = [];
	let current = raw[0];

	for (let i = 1; i < raw.length; i++) {
		const next = raw[i];
		if (next.start <= current.end) {
			// Overlapping or touching — extend.
			current = { start: current.start, end: Math.max(current.end, next.end) };
		} else {
			merged.push(current);
			current = next;
		}
	}
	merged.push(current);

	// Step 5: cap to maxSpans earliest windows.
	const capped = merged.slice(0, maxSpans);

	// Step 6: build result spans from the original-case text.
	return capped.map((w) => ({ start: w.start, end: w.end, text: text.slice(w.start, w.end) }));
}

/**
 * Project an {@link ExtractionSpan} onto the offset-only shape `RetrievedEvidence.extractionSpans` persists
 * (`{ start, end }`). The `text` field is EPHEMERAL — it is a convenience slice for the synthesis step and is
 * re-sliceable from the stored source document, so it MUST be dropped before an extraction span is persisted as
 * evidence (the evidence schema has no `text` field; passing the full span would be silently stripped). Use this
 * adapter at the extract → evidence seam to make that contract explicit.
 */
export function toEvidenceSpan(span: ExtractionSpan): { start: number; end: number } {
	return { start: span.start, end: span.end };
}
