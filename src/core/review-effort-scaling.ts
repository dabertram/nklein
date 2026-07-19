/**
 * F12.35 confidence-gated review + effort scaling (the DOWN pattern) — PURE core.
 *
 * The expensive second-opinion / multi-lens / debate machinery is worth its cost on a doubtful card and actively
 * HARMFUL on an easy green one: needless debate injects mistakes (DOWN reports up to 6× efficiency AND fewer
 * induced errors when the deep pass is gated rather than always-on). So review depth becomes a function of the
 * evidence — difficulty, whether the deterministic checks are green, how confident the worker was, whether the
 * lenses already disagree, and how uncertain the routing was.
 *
 * Honesty stance: this scales effort DOWN only when the evidence is genuinely reassuring. Anything unknown
 * (absent confidence, absent check result) is treated as NOT reassuring — an unmeasured card gets the standard
 * pass, never the cheap one, because "we didn't look" must never read as "it's fine".
 */

export type ReviewDepth = "skip_deep" | "standard" | "deep";

export interface ReviewEffortInput {
	/** Card difficulty 0..1 (higher = harder). */
	readonly difficulty: number;
	/**
	 * Did the deterministic checks (acceptance/type/lint) come back GREEN? `null` = they did not run, which is
	 * NOT the same as green and never earns the cheap path.
	 */
	readonly deterministicGreen: boolean | null;
	/** Worker's self-reported confidence 0..1, when the surface produced one; null = unknown. */
	readonly workerConfidence?: number | null;
	/** True when review lenses/candidates already disagree — the strongest signal to go deep. */
	readonly lensDisagreement?: boolean;
	/** Routing uncertainty 0..1 (how unsure the router was that this model fits); null = unknown. */
	readonly routingUncertainty?: number | null;
}

export interface ReviewEffortPlan {
	readonly depth: ReviewDepth;
	/** Suggested number of review eyes/passes (1 = single reviewer, ≥3 = panel). */
	readonly reviewPasses: number;
	/** Suggested debate/confer rounds (0 on the cheap path — debate is what injects errors). */
	readonly debateRounds: number;
	readonly reason: string;
}

/** Above this difficulty a card always gets at least the standard pass, however confident everything looks. */
const EASY_CEILING = 0.4;
/** Worker confidence must clear this to count as reassuring. */
const CONFIDENT_FLOOR = 0.7;
/** Routing uncertainty above this pulls effort UP regardless of the other signals. */
const UNCERTAIN_ROUTING = 0.5;

/**
 * Decide how much review a card warrants. Deterministic and explainable — the reason names the signal that drove
 * the decision, so an operator can see WHY a card got (or skipped) the deep pass.
 */
export function planReviewEffort(input: ReviewEffortInput): ReviewEffortPlan {
	const difficulty = Number.isFinite(input.difficulty) ? Math.max(0, Math.min(1, input.difficulty)) : 1;
	const confidence = input.workerConfidence ?? null;
	const routingUncertainty = input.routingUncertainty ?? null;

	// Strongest UP signal: the reviewers already disagree, so more eyes are the point.
	if (input.lensDisagreement === true) {
		return {
			depth: "deep",
			reviewPasses: 4,
			debateRounds: 2,
			reason: "lenses disagree — the deep pass exists precisely for this case",
		};
	}
	if (input.deterministicGreen === false) {
		return {
			depth: "deep",
			reviewPasses: 3,
			debateRounds: 1,
			reason: "deterministic checks are RED — review the failure, do not sample around it",
		};
	}
	if (difficulty > 0.75 || (routingUncertainty !== null && routingUncertainty > UNCERTAIN_ROUTING)) {
		return {
			depth: "deep",
			reviewPasses: 3,
			debateRounds: 1,
			reason:
				difficulty > 0.75
					? `hard card (difficulty ${difficulty.toFixed(2)}) — depth is warranted`
					: `uncertain routing (${(routingUncertainty ?? 0).toFixed(2)}) — the model may not fit this card`,
		};
	}

	// DOWN path: every reassuring signal must be PRESENT and positive — unknowns never buy the cheap path.
	const easy = difficulty <= EASY_CEILING;
	const green = input.deterministicGreen === true;
	const confident = confidence !== null && confidence >= CONFIDENT_FLOOR;
	if (easy && green && confident) {
		return {
			depth: "skip_deep",
			reviewPasses: 1,
			debateRounds: 0,
			reason: `easy card (${difficulty.toFixed(2)}), deterministic checks green, worker confidence ${confidence.toFixed(2)} — a debate here injects more errors than it catches`,
		};
	}

	const missing: string[] = [];
	if (!easy) {
		missing.push(`difficulty ${difficulty.toFixed(2)} above the easy ceiling`);
	}
	if (!green) {
		missing.push(input.deterministicGreen === null ? "deterministic checks did not run" : "checks not green");
	}
	if (!confident) {
		missing.push(confidence === null ? "worker confidence unknown" : `confidence ${confidence.toFixed(2)} below bar`);
	}
	return {
		depth: "standard",
		reviewPasses: 2,
		debateRounds: 0,
		reason: `standard review — ${missing.join("; ")}`,
	};
}
