/**
 * P20.10 — POST-ACCEPTANCE CHURN: what fraction of accepted work was later deleted or rewritten. PURE core.
 *
 * Every other quality signal this project has measures a MOMENT: the review approved, the acceptance command
 * exited zero, the card reached `completed`. Churn measures what happened afterwards — and it is the only one an
 * agent cannot influence, because it is written by the people who had to live with the result.
 *
 * That property matters more than it first appears. P20.1 hardened our grader against board-only state tampering,
 * but even independent acceptance is a point-in-time check the agent can optimize against. Churn is longitudinal
 * evidence outside that moment. A card whose code was entirely rewritten within 24 hours was not a durable success,
 * whatever its board and acceptance command recorded at the time.
 *
 * ── THE DISTINCTION THAT MAKES THIS USABLE RATHER THAN JUST DISCOURAGING ──
 * Some churn is healthy. Code gets refactored, requirements move, a follow-up card touches the same file. Churn
 * measured without a window would eventually approach 100% for any line of code, which would make the metric
 * true and useless. So it is measured at **24h and 7d**: churn inside 24h is close to "this was wrong on
 * arrival"; churn by 7d includes ordinary iteration. **The GAP between the two is more informative than either
 * number**, because it separates "we shipped the wrong thing" from "the thing moved".
 *
 * ── SMALL DENOMINATORS ARE THE TRAP ──
 * A card that authored 4 lines, 3 of which were later touched, reports 75% churn. That is not a signal, it is
 * arithmetic on a sample too small to mean anything — and it will dominate any ranking sorted by churn rate. So
 * a minimum authored-line count is required before a rate is reported at all, and below it the result is
 * `indeterminate` rather than a large, alarming, meaningless number.
 */

export type ChurnVerdict = "healthy" | "elevated" | "rewritten" | "indeterminate";

export interface ChurnObservation {
	readonly cardId: string;
	/** Lines the agent authored and that were ACCEPTED. */
	readonly authoredLines: number;
	/** Of those, how many were deleted or rewritten within 24 hours. */
	readonly churnedWithin24h: number;
	/** Of those, how many were deleted or rewritten within 7 days (includes the 24h figure). */
	readonly churnedWithin7d: number;
}

/** Below this many authored lines a churn RATE is arithmetic rather than signal. */
export const MIN_AUTHORED_LINES = 20;
/** 24h churn above this reads as "wrong on arrival" rather than iteration. OPERATIONAL DEFAULT (P18.5). */
export const REWRITTEN_24H_RATE = 0.5;
/** 24h churn above this is worth attention without being damning. OPERATIONAL DEFAULT (P18.5). */
export const ELEVATED_24H_RATE = 0.2;

export interface ChurnAssessment {
	readonly cardId: string;
	readonly verdict: ChurnVerdict;
	readonly rate24h: number | null;
	readonly rate7d: number | null;
	/** rate7d − rate24h: churn that arrived with ITERATION rather than on day one. */
	readonly iterationGap: number | null;
	readonly reason: string;
}

/**
 * Assess one card's churn.
 *
 * Judges on the 24h rate, not the 7d rate. Seven-day churn conflates "this was wrong" with "the code evolved",
 * and a metric that punishes evolution would push the harness toward work nobody touches afterwards — which is
 * not the same thing as work that was right.
 */
export function assessChurn(observation: ChurnObservation): ChurnAssessment {
	const authored = Math.max(0, Math.trunc(observation.authoredLines));

	if (authored < MIN_AUTHORED_LINES) {
		return {
			cardId: observation.cardId,
			verdict: "indeterminate",
			rate24h: null,
			rate7d: null,
			iterationGap: null,
			reason: `only ${authored} authored line(s), below the ${MIN_AUTHORED_LINES} needed for a rate to mean anything — a 3-of-4 card reports 75% churn, which is arithmetic rather than signal and would dominate any ranking sorted by rate`,
		};
	}

	const churn24 = Math.min(authored, Math.max(0, Math.trunc(observation.churnedWithin24h)));
	// 7d includes 24h by definition; a caller reporting less is describing something else, so clamp rather than
	// produce a negative iteration gap that would read as code being un-churned.
	const churn7 = Math.min(authored, Math.max(churn24, Math.trunc(observation.churnedWithin7d)));

	const rate24h = churn24 / authored;
	const rate7d = churn7 / authored;
	const iterationGap = rate7d - rate24h;

	const verdict: ChurnVerdict =
		rate24h >= REWRITTEN_24H_RATE ? "rewritten" : rate24h >= ELEVATED_24H_RATE ? "elevated" : "healthy";

	const pct = (value: number) => `${(value * 100).toFixed(0)}%`;
	const reason =
		verdict === "rewritten"
			? `${pct(rate24h)} of ${authored} accepted line(s) were gone within 24h — this card was WRONG ON ARRIVAL whatever the board recorded. Churn is written by the people who had to live with the result, so it is the one quality signal an agent cannot influence`
			: verdict === "elevated"
				? `${pct(rate24h)} churned within 24h — worth attention, not damning. Iteration added a further ${pct(iterationGap)} by 7d`
				: `${pct(rate24h)} churned within 24h over ${authored} line(s) — the work survived contact. Ordinary iteration added ${pct(iterationGap)} by 7d`;

	return { cardId: observation.cardId, verdict, rate24h, rate7d, iterationGap, reason };
}

export interface ChurnSummary {
	readonly assessed: readonly ChurnAssessment[];
	readonly indeterminate: readonly ChurnAssessment[];
	/** Mean 24h rate across cards LARGE ENOUGH to judge. */
	readonly meanRate24h: number | null;
	readonly text: string;
}

/**
 * Summarise churn across cards.
 *
 * Cards too small to judge are reported SEPARATELY rather than dropped or averaged in. Averaging them would let
 * a handful of 3-line cards swing the mean; dropping them silently would hide that the sample covers fewer cards
 * than it appears to — the same pair of errors the infra-error rate avoids in P20.7.
 */
export function summariseChurn(observations: readonly ChurnObservation[]): ChurnSummary {
	const all = observations.map(assessChurn);
	const judged = all.filter((assessment) => assessment.rate24h !== null);
	const indeterminate = all.filter((assessment) => assessment.rate24h === null);

	const meanRate24h =
		judged.length === 0
			? null
			: judged.reduce((total, assessment) => total + (assessment.rate24h ?? 0), 0) / judged.length;

	return {
		assessed: all,
		indeterminate,
		meanRate24h,
		text:
			judged.length === 0
				? `no card had ${MIN_AUTHORED_LINES}+ authored lines — churn is UNMEASURED, which is not the same as low`
				: `mean 24h churn ${((meanRate24h ?? 0) * 100).toFixed(0)}% over ${judged.length} judgeable card(s); ${indeterminate.length} card(s) too small to judge and excluded from the mean`,
	};
}
