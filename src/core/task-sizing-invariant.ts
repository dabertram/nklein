/**
 * P21.6 — "one task = one context window = one PR" as a HARD sizing invariant. PURE core.
 *
 * Backlog.md's framing is the sharpest in the field: *"AI agents can now produce more plausible code in an hour
 * than you can carefully read in a day. The bottleneck is no longer writing code. It's your attention."*
 *
 * ── THE RULE, AND WHY THE TIGHTER SIDE MUST WIN ──
 * Two independent ceilings bound a task:
 *  1. **Model context** — what the model can hold and still reason well over.
 *  2. **Review capacity** — what a human can read carefully before their attention gives out.
 * The task must fit under BOTH, so the tighter one binds. F12.110's depth-target work currently optimises only
 * the model-context side, which is the half that keeps getting cheaper: every context-window increase loosens
 * ceiling 1 and **leaves ceiling 2 exactly where it was.** Optimising only the side that moves is how a system
 * ends up producing 4,000-line changes that no one reviews, each of them individually justified.
 *
 * ── THE ASYMMETRY THAT MAKES THIS MORE THAN A `Math.min` ──
 * Exceeding the model ceiling degrades output, and the system NOTICES: quality drops, retries fire, the ladder
 * escalates. Exceeding the review ceiling degrades *review*, and the system notices **nothing** — the diff still
 * applies, the tests still pass, the PR still merges. It fails silently, and it fails on the side where the
 * consequences are least recoverable, because unreviewed code is how defects reach main.
 *
 * So when the review ceiling binds, this core says so LOUDLY and does not offer a way to relax it from model
 * capability. **Review capacity is a property of the reviewer, not of the model**, and inferring one from the
 * other is the exact substitution the invariant exists to forbid — a bigger model does not make a person able to
 * read more code.
 */

export type BindingConstraint = "model_context" | "review_capacity" | "both" | "neither";

export interface TaskSizingInput {
	/** Tokens the model can hold and still reason well over — the QUALITY-effective window, not the advertised one. */
	readonly modelContextTokens: number;
	/** Estimated tokens this task needs in context. */
	readonly estimatedTaskTokens: number;
	/**
	 * Changed lines a reviewer can read CAREFULLY in one sitting. A human property, supplied by configuration or
	 * observation — never derived from the model.
	 */
	readonly reviewCapacityLines: number;
	/** Estimated changed lines this task will produce. */
	readonly estimatedDiffLines: number;
}

export interface TaskSizingVerdict {
	readonly fits: boolean;
	readonly binding: BindingConstraint;
	/** Fraction of the model context this task would occupy. */
	readonly contextUtilisation: number;
	/** Fraction of the reviewer's capacity this task would consume. */
	readonly reviewUtilisation: number;
	/** How many times over the tighter ceiling the task is; 1 or below means it fits. */
	readonly overshoot: number;
	readonly mustSplit: boolean;
	readonly reason: string;
}

/** Utilisation above this is "fits, but leaves no room" — worth flagging before it becomes a problem. */
export const COMFORTABLE_UTILISATION = 0.8;

function ratio(need: number, ceiling: number): number {
	if (!Number.isFinite(ceiling) || ceiling <= 0) {
		// An unknown or nonsensical ceiling must not read as infinite room.
		return Number.POSITIVE_INFINITY;
	}
	return Math.max(0, need) / ceiling;
}

/**
 * Decide whether a task fits, and say which ceiling binds.
 *
 * Reports the binding constraint by NAME rather than just a boolean, because the remedy differs completely: a
 * model-context overrun can be answered with a bigger model, more aggressive compaction, or better retrieval — a
 * review-capacity overrun can only be answered by making the task smaller. Returning a bare "too big" would let
 * someone reach for the wrong lever, and the wrong lever here is the one that is always available.
 */
export function decideTaskSizing(input: TaskSizingInput): TaskSizingVerdict {
	const contextUtilisation = ratio(input.estimatedTaskTokens, input.modelContextTokens);
	const reviewUtilisation = ratio(input.estimatedDiffLines, input.reviewCapacityLines);

	const contextOver = contextUtilisation > 1;
	const reviewOver = reviewUtilisation > 1;
	const overshoot = Math.max(contextUtilisation, reviewUtilisation);

	const binding: BindingConstraint =
		contextOver && reviewOver ? "both" : reviewOver ? "review_capacity" : contextOver ? "model_context" : "neither";

	const fits = !contextOver && !reviewOver;

	let reason: string;
	if (binding === "review_capacity") {
		reason = `REVIEW CAPACITY binds: ~${Math.round(input.estimatedDiffLines)} changed line(s) against a ${input.reviewCapacityLines}-line careful-review budget (${reviewUtilisation.toFixed(1)}×). This cannot be fixed with a bigger model — review capacity belongs to the reviewer. Split the task.`;
	} else if (binding === "model_context") {
		reason = `MODEL CONTEXT binds: ~${Math.round(input.estimatedTaskTokens)} token(s) against a ${input.modelContextTokens}-token effective window (${contextUtilisation.toFixed(1)}×). Compaction, retrieval or a larger-context model can address this.`;
	} else if (binding === "both") {
		reason = `BOTH ceilings exceeded (context ${contextUtilisation.toFixed(1)}×, review ${reviewUtilisation.toFixed(1)}×). Split first — a larger model would fix only the half the system already complains about, and would leave the silent half untouched.`;
	} else if (Math.max(contextUtilisation, reviewUtilisation) > COMFORTABLE_UTILISATION) {
		const tight = reviewUtilisation >= contextUtilisation ? "review capacity" : "model context";
		reason = `Fits, but tight against ${tight} (${(Math.max(contextUtilisation, reviewUtilisation) * 100).toFixed(0)}% used) — any growth during execution will push it over.`;
	} else {
		reason = `Fits comfortably: ${(contextUtilisation * 100).toFixed(0)}% of context, ${(reviewUtilisation * 100).toFixed(0)}% of review capacity.`;
	}

	return {
		fits,
		binding,
		contextUtilisation,
		reviewUtilisation,
		overshoot,
		mustSplit: !fits,
		reason,
	};
}

/**
 * How many pieces a task must be split into to satisfy BOTH ceilings.
 *
 * Uses the tighter ratio, rounded up. Returns 1 for a task that already fits — never 0, which would read as "no
 * pieces needed" and could be mistaken for "do not do it".
 */
export function requiredSplitCount(verdict: TaskSizingVerdict): number {
	if (verdict.fits) {
		return 1;
	}
	if (!Number.isFinite(verdict.overshoot)) {
		// An unknown ceiling cannot produce a credible split count; asking for 2 is the honest minimum, and the
		// caller should be told the ceiling is unknown rather than handed a fabricated number.
		return 2;
	}
	return Math.max(2, Math.ceil(verdict.overshoot));
}
