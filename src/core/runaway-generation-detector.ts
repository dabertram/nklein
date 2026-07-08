/**
 * Runaway-generation detector (§5.AA robustness — live-found sweep run 9, 2026-07-08).
 *
 * A weak local model on a worker card can fall into a DEGENERATE generation: it emits the same line (or the same short
 * cycle of characters) over and over, or produces an unbounded wall of text, never closing the turn. Under an `unlimited`
 * agent-timeout budget (a legitimate user choice for genuinely-long work) such a turn has no wall-clock backstop and
 * freezes the card — and, because chat turns serialize per session, the whole board — indefinitely. Observed live: a 9B
 * sat on ONE generation for 15+ minutes with no tool call and no progress.
 *
 * The key insight that makes this fixable without a timeout: a RUNAWAY is not the same as slow-but-legitimate work. A
 * long correct generation keeps producing NEW structure; a runaway repeats or degenerates. That difference is detectable
 * from the accumulated text alone — structurally, cheaply, and independently of wall-clock — so a detector can bounce a
 * runaway into the §5.AA retry ladder (fresh attempt / model switch) even while `unlimited` correctly lets a genuinely
 * long turn run to completion.
 *
 * This module is PURE: it inspects accumulated generation text and returns a decision. The effectful half (sampling the
 * in-flight stream and aborting on a runaway verdict) rides the same vendored model-call seam as the other §5.AA rungs
 * and is wired separately; keeping the decision pure means it is fully unit-tested here without a live model.
 */

/** Why a generation was judged runaway. `repetition` = a cyclic/looping tail; `length_ceiling` = an unbounded wall. */
export type RunawayReason = "repetition" | "length_ceiling";

export interface RunawayVerdict {
	/** True when the generation looks degenerate and should be bounced into the retry ladder. */
	runaway: boolean;
	/** The dominant reason, when runaway. */
	reason?: RunawayReason;
	/** Human-readable detail for the operator log / ledger event. */
	detail?: string;
}

export interface RunawayDetectorOptions {
	/**
	 * Hard character ceiling for a single generation turn. A worker/plan turn that emits more than this without closing is
	 * almost certainly degenerate (normal tool-calling turns are far shorter). Default 24000 (~6k tokens of pure text).
	 */
	maxChars?: number;
	/**
	 * Below this many characters, NO verdict is runaway — early generation is too short to judge, and a brief repeat
	 * ("no, no, no") is not yet a loop. Default 400.
	 */
	minCharsBeforeJudging?: number;
	/** Longest repeating-unit period (chars) to search for. Default 120 (catches a repeated line up to ~120 chars). */
	maxCyclePeriod?: number;
	/**
	 * Minimum length (chars) of the periodic tail region for a repetition verdict. A short coincidental repeat must not
	 * trip it; a genuine loop piles up quickly. Default 200.
	 */
	minCycleSpanChars?: number;
	/** Minimum number of whole repetitions of the unit within the periodic tail. Default 3. */
	minCycleRepeats?: number;
}

const DEFAULTS: Required<RunawayDetectorOptions> = {
	maxChars: 24000,
	minCharsBeforeJudging: 400,
	maxCyclePeriod: 120,
	minCycleSpanChars: 200,
	minCycleRepeats: 3,
};

/** Result of scanning the tail for a repeating cycle. */
export interface TailCycle {
	/** The period (unit length in chars) of the repeat. */
	period: number;
	/** How many whole units repeat at the tail. */
	repeats: number;
	/** The length of the periodic region (chars). */
	spanChars: number;
	/** The repeating unit itself (the last `period` chars). */
	unit: string;
}

/**
 * Find the SMALLEST-period repeating cycle at the tail of `text`, if any is long enough to matter. Pure. Scans periods
 * `p = 1..maxPeriod`; for each, measures how far back from the end the string is periodic with period `p` (i.e. every
 * char equals the char `p` positions earlier), and returns the first `p` whose periodic region spans at least
 * `minSpanChars` and `minRepeats` whole units. Returns null when the tail is not degenerately repetitive.
 *
 * Smallest period first means `"aaaa…"` is reported with period 1 (repeats = span) rather than 2/3/…, and a repeated
 * 40-char line is reported with period 40 — the tightest description of the loop.
 */
export function findPeriodicTailCycle(
	text: string,
	maxPeriod: number,
	minSpanChars: number,
	minRepeats: number,
): TailCycle | null {
	const n = text.length;
	for (let period = 1; period <= maxPeriod; period++) {
		if (n < period * minRepeats) {
			continue;
		}
		// Count how many trailing characters are periodic with this period: text[i] === text[i - period].
		let matchLen = 0;
		while (n - 1 - matchLen - period >= 0 && text[n - 1 - matchLen] === text[n - 1 - matchLen - period]) {
			matchLen++;
		}
		if (matchLen === 0) {
			continue;
		}
		// The periodic region is the matched tail plus the one leading unit that seeds it.
		const spanChars = matchLen + period;
		const repeats = Math.floor(spanChars / period);
		if (spanChars >= minSpanChars && repeats >= minRepeats) {
			return { period, repeats, spanChars, unit: text.slice(n - period) };
		}
	}
	return null;
}

/**
 * Judge whether an accumulated generation looks RUNAWAY (degenerate) and should be bounced into the retry ladder. Pure.
 * Checks, in order of signal strength:
 *   1. Repetition — a looping cyclic tail (the classic weak-model "same line forever"), via {@link findPeriodicTailCycle}.
 *   2. Length ceiling — the turn has blown past `maxChars` without closing.
 * Returns `{ runaway: false }` while the text is shorter than `minCharsBeforeJudging` (too early to tell). A genuinely
 * long BUT non-repetitive generation under the ceiling is NOT flagged — that is the slow-but-legitimate case `unlimited`
 * is meant to allow.
 */
export function detectRunawayGeneration(text: string, options: RunawayDetectorOptions = {}): RunawayVerdict {
	const opts = { ...DEFAULTS, ...options };
	if (text.length < opts.minCharsBeforeJudging) {
		return { runaway: false };
	}

	const cycle = findPeriodicTailCycle(text, opts.maxCyclePeriod, opts.minCycleSpanChars, opts.minCycleRepeats);
	if (cycle) {
		const preview = cycle.unit.replace(/\s+/g, " ").trim().slice(0, 40);
		return {
			runaway: true,
			reason: "repetition",
			detail: `looping tail: unit of ${cycle.period} chars repeated ${cycle.repeats}× (${cycle.spanChars} chars)${preview ? ` — "${preview}"` : ""}`,
		};
	}

	if (text.length > opts.maxChars) {
		return {
			runaway: true,
			reason: "length_ceiling",
			detail: `generation exceeded ${opts.maxChars} chars (${text.length}) without closing the turn`,
		};
	}

	return { runaway: false };
}
