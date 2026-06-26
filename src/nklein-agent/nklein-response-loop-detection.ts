/**
 * Detect when a local model has fallen into emitting a **repeating cycle** at the tail of its output, so the caller
 * can CUT OFF and salvage the useful prefix instead of waiting out a wall-time budget (todo §5.AA).
 *
 * Grounded in the §5.Z cross-model sweep: `qwen3.5-9b` finished a task, then looped re-emitting an identical
 * "The file ... has been created ..." final message indefinitely — the work was already done, but the session never
 * terminated. Weak/quantized models do this with phrases, sentences, or token runs. The project principle is to be
 * **robust against weak-model output behaviour rather than trying to teach the model**: detect the loop and act
 * (salvage / retry / park), don't re-prompt.
 *
 * Pure + deterministic so it can guard BOTH the chat path (streamed deltas) and the swarm session runtime (final
 * messages) from one shared seam. It looks only at a consecutive repeated run anchored at the END of the text (the
 * live "it's stuck repeating right now" signal); natural prose that merely reuses a word is left alone.
 */

export interface ResponseLoopDetection {
	/** True when the tail is a unit repeated at least `minRepeats` times in a row. */
	looping: boolean;
	/** The text to keep: everything up to and including the FIRST occurrence of the repeated unit (loop collapsed). */
	salvagedText: string;
	/** The smallest repeating unit found (trimmed), when looping. */
	repeatedUnit?: string;
	/** How many consecutive times the unit repeats at the tail, when looping. */
	repeats?: number;
}

export interface ResponseLoopOptions {
	/** Minimum consecutive repeats of the tail unit to call it a loop. Default 4. */
	minRepeats?: number;
	/** Shortest unit length to consider (avoids flagging trivial short runs as loops). Default 12. */
	minUnitLen?: number;
	/** Longest unit length to consider. Default 4000. */
	maxUnitLen?: number;
}

/**
 * Find the smallest unit length `L (minUnitLen ≤ L ≤ maxUnitLen)` such that the text ends with that `L`-char unit
 * repeated `≥ minRepeats` times consecutively, and report the salvageable prefix (the text with the trailing repeats
 * collapsed to a single occurrence). Smallest-unit-first so `abcabcabc…` is reported as period `abc`, not a multiple.
 */
export function detectResponseLoop(text: string, options: ResponseLoopOptions = {}): ResponseLoopDetection {
	const minRepeats = Math.max(2, options.minRepeats ?? 4);
	const minUnitLen = Math.max(1, options.minUnitLen ?? 12);
	const n = text.length;
	const maxUnitLen = Math.min(options.maxUnitLen ?? 4000, Math.floor(n / minRepeats));
	if (n < minUnitLen * minRepeats || maxUnitLen < minUnitLen) {
		return { looping: false, salvagedText: text };
	}
	for (let unitLen = minUnitLen; unitLen <= maxUnitLen; unitLen += 1) {
		const unit = text.slice(n - unitLen);
		// A unit that is itself only whitespace would match almost anything — skip it (require some real content).
		if (unit.trim().length === 0) {
			continue;
		}
		let repeats = 1;
		let pos = n - unitLen;
		while (pos - unitLen >= 0 && text.slice(pos - unitLen, pos) === unit) {
			repeats += 1;
			pos -= unitLen;
		}
		if (repeats >= minRepeats) {
			// `pos` is now the start of the FIRST occurrence in the repeated run; keep the prefix + one unit.
			const salvagedText = text.slice(0, pos + unitLen).trimEnd();
			return { looping: true, salvagedText, repeatedUnit: unit.trim(), repeats };
		}
	}
	return { looping: false, salvagedText: text };
}
