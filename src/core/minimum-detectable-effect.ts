/**
 * P20.6 — the MINIMUM DETECTABLE EFFECT, computed BEFORE the run. PURE core.
 *
 * F12.41 already decides whether an observed difference is significant, and F12.28 already reports `unresolved`
 * when it cannot tell. Both act AFTER the fleet time is spent. This module answers the question that has to come
 * first: **given the task set we can actually afford, what is the smallest effect we could detect even in
 * principle?** If the answer is larger than the effect being looked for, the study cannot succeed, and running it
 * produces an expensive `unresolved` that reads like bad luck rather than like arithmetic.
 *
 * ── THE RESULT THAT MATTERS MOST, AND THE ONE PEOPLE ROUTINELY GET WRONG ──
 * **Repeats fix RUN noise. Only more TASKS fix TASK-SAMPLING noise.**
 * On a 100-task suite, even INFINITE repeats floor the MDE near ~8.8 pp. So the instinct to "run it again a few
 * more times to be sure" cannot rescue an underpowered comparison — it buys precision on the wrong variance
 * component while feeling like rigour. `taskFloorMde` is reported separately from the achievable MDE precisely so
 * this is visible: when the two are close, more repeats are wasted fleet hours.
 *
 * Miller (arXiv 2411.00640): detecting 3 pp at 80% power needs n ≈ 969; clustered SEs run up to 3× larger than
 * naive; paired question-level differences are roughly a 5× sample-size saving and are FREE. On an 89–225-task
 * suite the honest MDE is ~10–18 pp.
 *
 * ── WHY THIS IS PRE-REGISTRATION AND NOT A CALCULATOR ──
 * The MDE must be fixed BEFORE seeing results, because afterwards there is always a defensible-sounding reason to
 * accept the effect you happened to observe. `assessPreRegistration` compares what a study CLAIMS to look for
 * against what it COULD find, and returns `underpowered_by_construction` when the claim exceeds the capability.
 * That verdict is not a warning to weigh against the result — **there is no result to weigh it against yet**, and
 * that is the entire value of computing it first.
 *
 * Approximations are labelled as such. These are normal-approximation sample-size formulas, adequate for deciding
 * "is this study worth running at all" and NOT a substitute for the exact test F12.41 runs on the actual data.
 *
 * ── ⚠️ CALIBRATION AGAINST THE PUBLISHED FIGURES — CHECKED, AND IT DOES NOT FULLY MATCH ──
 * Measured 2026-07-20 against the numbers in P20.6:
 *  - **Matches:** an 89–225-task suite yields 18.8 → 11.8 pp here, against the published "~10–18 pp". Good.
 *  - **Does NOT match:** Miller's "3 pp at 80% power needs n ≈ 969" comes out at **6.36 pp** here even with
 *    pairing and clustering turned OFF — roughly 2× conservative. Likewise the "100-task suite floors near
 *    8.8 pp" figure comes out at ~12.5–14 pp.
 * The gap is almost certainly the variance model: this uses the worst-case independent-two-proportion term
 * `2p(1−p)` at p=0.5, whereas a paired binary design's variance depends on the DISCORDANT rate, which is usually
 * much smaller. **The constants were NOT tuned to reproduce the published number**, because a formula fitted to
 * one citation it cannot derive is a formula nobody can reason about later.
 * **The error direction is the safe one and that is why it ships as-is:** this OVER-states the MDE, so it will
 * call a study underpowered somewhat more often than strictly necessary. That costs extra tasks. The opposite
 * error — under-stating the MDE — would bless an underpowered study as adequate, which is precisely the failure
 * this module exists to prevent. Treat the output as an upper bound on the detectable effect.
 */

/** z for a two-sided α=0.05 and for 80% power — the conventional defaults, stated rather than hidden. */
const Z_ALPHA_TWO_SIDED_05 = 1.96;
const Z_POWER_80 = 0.8416;
/** Paired question-level differencing is worth roughly a 5× sample-size saving (Miller). */
const PAIRED_EFFICIENCY = 5;
/** Clustered standard errors run up to 3× larger than naive ones; assume the middle of that range by default. */
const DEFAULT_CLUSTER_INFLATION = 2;

export interface MdeInput {
	/** Number of distinct TASKS. This is the number that sets the floor. */
	readonly taskCount: number;
	/** Repeats per task. Reduces run noise only — see the docblock. */
	readonly repeats?: number;
	/** Baseline pass rate, used for the variance term. 0.5 is the worst case and the honest default. */
	readonly baselineRate?: number;
	/** Paired comparison on an identical task set — roughly a 5× saving, and free. */
	readonly paired?: boolean;
	/** Clustered-SE inflation factor (1 = naive, up to 3 observed). */
	readonly clusterInflation?: number;
}

export interface MdeReport {
	/** Smallest detectable difference, in percentage points, given tasks AND repeats. */
	readonly achievableMdePoints: number;
	/**
	 * The floor set by TASK COUNT alone — what the MDE approaches as repeats → ∞. When this is close to the
	 * achievable MDE, additional repeats cannot help.
	 */
	readonly taskFloorMdePoints: number;
	/** True when repeats have already bought nearly all they can. */
	readonly repeatsExhausted: boolean;
	readonly summary: string;
}

/** Effective sample size after paired and clustering adjustments. */
function effectiveN(taskCount: number, repeats: number, paired: boolean, clusterInflation: number): number {
	const tasks = Math.max(0, Math.trunc(taskCount));
	const reps = Math.max(1, Math.trunc(repeats));
	if (tasks === 0) {
		return 0;
	}
	// Repeats reduce run variance but not task-sampling variance, so their contribution saturates. Modelled as a
	// diminishing term rather than a linear one — a linear model would imply repeats can substitute for tasks,
	// which is exactly the error this module exists to prevent.
	const repeatGain = 1 + (1 - 1 / reps);
	const paidFor = tasks * repeatGain * (paired ? PAIRED_EFFICIENCY : 1);
	return paidFor / (clusterInflation * clusterInflation);
}

function mdeFromN(n: number, baselineRate: number): number {
	if (n <= 0) {
		return Number.POSITIVE_INFINITY;
	}
	const variance = 2 * baselineRate * (1 - baselineRate);
	return (Z_ALPHA_TWO_SIDED_05 + Z_POWER_80) * Math.sqrt(variance / n) * 100;
}

/**
 * Compute what this study could detect.
 *
 * Reports the task floor alongside the achievable MDE so "add more repeats" can be rejected on arithmetic rather
 * than on judgement.
 */
export function computeMinimumDetectableEffect(input: MdeInput): MdeReport {
	const baselineRate = input.baselineRate ?? 0.5;
	const paired = input.paired ?? true;
	const clusterInflation = Math.max(1, input.clusterInflation ?? DEFAULT_CLUSTER_INFLATION);
	const repeats = Math.max(1, Math.trunc(input.repeats ?? 1));

	const achievable = mdeFromN(effectiveN(input.taskCount, repeats, paired, clusterInflation), baselineRate);
	// The floor: repeats → ∞, so the repeat gain saturates at 2.
	const floor = mdeFromN(
		Math.max(0, Math.trunc(input.taskCount)) === 0
			? 0
			: (Math.trunc(input.taskCount) * 2 * (paired ? PAIRED_EFFICIENCY : 1)) / (clusterInflation * clusterInflation),
		baselineRate,
	);

	const repeatsExhausted = Number.isFinite(achievable) && achievable <= floor * 1.1;

	return {
		achievableMdePoints: achievable,
		taskFloorMdePoints: floor,
		repeatsExhausted,
		summary:
			input.taskCount <= 0
				? "no tasks — nothing is detectable, and this is arithmetic rather than a pessimistic estimate"
				: `With ${input.taskCount} task(s) × ${repeats} repeat(s), the smallest detectable difference is ~${achievable.toFixed(1)} pp (task-count floor ~${floor.toFixed(1)} pp).${
						repeatsExhausted
							? " MORE REPEATS CANNOT HELP: repeats fix run noise, only more TASKS fix task-sampling noise. Additional runs here are wasted fleet hours."
							: ""
					}`,
	};
}

export type PreRegistrationVerdict = "adequately_powered" | "underpowered_by_construction";

export interface PreRegistrationAssessment {
	readonly verdict: PreRegistrationVerdict;
	readonly declaredMdePoints: number;
	readonly achievableMdePoints: number;
	/** Tasks needed to detect the declared effect, when the study as designed cannot. */
	readonly tasksNeeded: number | null;
	readonly reason: string;
}

/**
 * Compare what a study says it is looking for against what it could find.
 *
 * Returns `underpowered_by_construction` when the declared effect is smaller than the achievable MDE. This is
 * deliberately a hard verdict rather than a caution: **it is computed before any data exists**, so there is
 * nothing to weigh it against, and the only honest responses are to enlarge the task set or to declare a larger
 * effect and admit that is what is being tested.
 */
export function assessPreRegistration(input: {
	readonly declaredMdePoints: number;
	readonly design: MdeInput;
}): PreRegistrationAssessment {
	const report = computeMinimumDetectableEffect(input.design);
	const declared = input.declaredMdePoints;
	const adequate = Number.isFinite(report.achievableMdePoints) && declared >= report.achievableMdePoints;

	if (adequate) {
		return {
			verdict: "adequately_powered",
			declaredMdePoints: declared,
			achievableMdePoints: report.achievableMdePoints,
			tasksNeeded: null,
			reason: `looking for ≥${declared.toFixed(1)} pp against an achievable ${report.achievableMdePoints.toFixed(1)} pp — the design can answer its question`,
		};
	}

	// Invert the MDE formula for the task count that would suffice, holding the rest of the design fixed.
	const baselineRate = input.design.baselineRate ?? 0.5;
	const paired = input.design.paired ?? true;
	const clusterInflation = Math.max(1, input.design.clusterInflation ?? DEFAULT_CLUSTER_INFLATION);
	const repeats = Math.max(1, Math.trunc(input.design.repeats ?? 1));
	const variance = 2 * baselineRate * (1 - baselineRate);
	const neededN =
		declared > 0 ? variance / (declared / 100 / (Z_ALPHA_TWO_SIDED_05 + Z_POWER_80)) ** 2 : Number.POSITIVE_INFINITY;
	const repeatGain = 1 + (1 - 1 / repeats);
	const tasksNeeded = Number.isFinite(neededN)
		? Math.ceil((neededN * clusterInflation * clusterInflation) / (repeatGain * (paired ? PAIRED_EFFICIENCY : 1)))
		: null;

	return {
		verdict: "underpowered_by_construction",
		declaredMdePoints: declared,
		achievableMdePoints: report.achievableMdePoints,
		tasksNeeded,
		reason: `looking for ≥${declared.toFixed(1)} pp but this design can only detect ~${report.achievableMdePoints.toFixed(1)} pp. UNDERPOWERED BY CONSTRUCTION — computed before any data exists, so there is nothing to weigh it against. ${
			tasksNeeded === null
				? "Enlarge the task set."
				: `~${tasksNeeded} task(s) would be needed at this design. ${report.repeatsExhausted ? "Adding repeats will NOT close the gap." : ""}`
		} The honest alternatives are more tasks, or declaring a larger effect and admitting that is what is being tested.`,
	};
}
