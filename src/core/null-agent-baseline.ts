/**
 * P20.1 — the NULL-AGENT BASELINE: run an agent that does nothing, and see what the grader gives it. PURE core.
 *
 * BenchJack (arXiv 2605.12673) achieved **~100% on Terminal-Bench, SWE-bench Verified, SWE-bench Pro and
 * WebArena without solving any task.** Two of its methods are worth memorising, because neither is exotic:
 *  - a **10-line `conftest.py` pytest hook** forcing every outcome to "passed";
 *  - a validator that checked only **that the last message came from the assistant** — so the literal input `{}`
 *    scored perfectly on all 890 tasks.
 *
 * Neither required understanding the tasks. Both produced flawless-looking results.
 *
 * ── THE ASSERTION THIS CORE EXISTS TO MAKE ──
 * **If an agent that does nothing scores above zero, the grader is forgeable and EVERY other number it produced
 * is meaningless — including the good ones.** Not "suspect", not "worth a caveat": meaningless. A forgeable
 * grader does not fail loudly; it produces plausible numbers that happen to measure nothing, and those numbers
 * are indistinguishable from real ones by inspection.
 *
 * That is why this gates the rest of Phase 20 and every Phase 13 claim. Any effort spent improving a score
 * before this passes might be improving the score of a metric that cannot be improved because it was never
 * measuring anything.
 *
 * ── WHY A RANDOM AGENT IS ALSO RUN ──
 * A null agent catches a grader that rewards *nothing*. A random agent catches a grader that rewards *activity*
 * — one that cannot distinguish work from flailing. A grader can pass the first test and fail the second, and
 * the second failure is subtler: the scores move, they look responsive, and they track effort rather than
 * correctness.
 */

export type GraderVerdict = "sound" | "forgeable" | "undiscriminating" | "indeterminate";

export interface BaselineScores {
	/** An agent that takes no action at all. MUST score zero. */
	readonly nullAgent: number | null;
	/** An agent taking valid but arbitrary actions. Should score near zero, well below a real agent. */
	readonly randomAgent: number | null;
	/** A real agent, for the gap that gives the grader its discriminating power. */
	readonly realAgent: number | null;
}

export interface GraderAssessment {
	readonly verdict: GraderVerdict;
	/** True when NO score from this grader should be believed. */
	readonly allNumbersVoid: boolean;
	readonly reason: string;
}

/**
 * The random agent must sit at least this far below the real agent for the grader to be discriminating.
 *
 * OPERATIONAL DEFAULT (P18.5), not measured. Set deliberately wide: a grader whose random and real agents sit
 * within a few points is not producing a usable signal whatever the statistics say about the difference.
 */
export const MIN_REAL_OVER_RANDOM_POINTS = 15;

/**
 * Assess whether a grader can be trusted at all.
 *
 * Checks the null agent FIRST and returns immediately on failure. A forgeable grader makes every subsequent
 * comparison meaningless, so continuing to evaluate the random/real gap would produce sub-verdicts about numbers
 * already known to be void — and a report containing any real-looking analysis invites someone to read past the
 * headline.
 */
export function assessGraderIntegrity(scores: BaselineScores): GraderAssessment {
	if (scores.nullAgent === null) {
		return {
			verdict: "indeterminate",
			allNumbersVoid: true,
			reason:
				"the null-agent baseline has NOT been run. Until it has, no score from this grader means anything — not because the grader is known to be broken, but because nothing has checked. P20.1 gates the rest of Phase 20 for exactly this reason",
		};
	}

	if (scores.nullAgent > 0) {
		return {
			verdict: "forgeable",
			allNumbersVoid: true,
			reason: `an agent that did NOTHING scored ${scores.nullAgent} — the grader is forgeable, and EVERY other number it produced is meaningless, including the good ones. BenchJack reached ~100% on four major benchmarks this way (a 10-line conftest.py hook; a validator that checked only that the last message came from the assistant, so "{}" scored perfectly on 890 tasks). Fix the grader before improving any score`,
		};
	}

	if (scores.randomAgent === null || scores.realAgent === null) {
		return {
			verdict: "indeterminate",
			allNumbersVoid: false,
			reason:
				"the null agent correctly scored zero, so the grader is not trivially forgeable — but without both a random-agent and a real-agent score its DISCRIMINATING power is unmeasured. A grader can reward activity rather than correctness and still give a null agent nothing",
		};
	}

	const gap = scores.realAgent - scores.randomAgent;
	if (gap < MIN_REAL_OVER_RANDOM_POINTS) {
		return {
			verdict: "undiscriminating",
			allNumbersVoid: true,
			reason: `a random agent scored ${scores.randomAgent} against the real agent's ${scores.realAgent} — a gap of ${gap.toFixed(1)} points, below the ${MIN_REAL_OVER_RANDOM_POINTS} needed to call this grader discriminating. This is the SUBTLER failure: the scores move, they look responsive, and they track EFFORT rather than correctness`,
		};
	}

	return {
		verdict: "sound",
		allNumbersVoid: false,
		reason: `null agent scored 0 and the real agent leads a random one by ${gap.toFixed(1)} points — the grader rewards neither nothing nor mere activity`,
	};
}

/**
 * Forgery vectors to test explicitly, taken from BenchJack rather than imagined.
 *
 * Listed as data because "we thought about grader forgery" and "we tested these five specific attacks" are
 * different claims, and only the second is checkable.
 */
export const FORGERY_VECTORS: readonly { readonly id: string; readonly description: string }[] = [
	{
		id: "test_hook_override",
		description: "a conftest.py (or equivalent) hook that forces every test outcome to passed — 10 lines",
	},
	{
		id: "trivial_validator_satisfaction",
		description:
			"satisfying a validator that checks only message shape or authorship, not content ('{}' scoring 100%)",
	},
	{
		id: "state_tampering",
		description: "writing the expected result directly into the state the grader reads, without doing the work",
	},
	{
		id: "random_activity",
		description: "valid but arbitrary actions, to catch a grader that rewards effort rather than correctness",
	},
	{
		id: "empty_output",
		description: "returning nothing at all, to catch a grader whose default path is a pass",
	},
];
