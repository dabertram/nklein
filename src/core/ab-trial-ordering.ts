/**
 * P20.7 — ordering A/B trials so THERMAL DRIFT cannot be mistaken for an effect. PURE core.
 *
 * A cloud lab runs its A arm and its B arm on machines that perform the same at minute 5 and minute 500. **A
 * laptop does not.** Sustained load raises temperature, the SoC throttles, and everything measured later is
 * slower than everything measured earlier — for reasons that have nothing to do with the arms.
 *
 * That makes trial ORDER a confound, and it is a confound the cloud evaluation literature never has to name, so
 * borrowed methodology does not warn about it. Run all of A then all of B and a thermal decline of a few percent
 * is indistinguishable from B being a few percent worse. **The comparison will produce a number, a p-value, and
 * a wrong conclusion.**
 *
 * ── ABBA CANCELS A LINEAR DRIFT, AND THAT IS THE WHOLE TRICK ──
 * Order the trials A,B,B,A. Under a drift that grows steadily with time, A occupies positions 1 and 4 and B
 * occupies 2 and 3 — so both arms carry the same average time-penalty and the difference between them is
 * unaffected. Sequential blocks (A,A,B,B) give A the two cool slots and B the two hot ones, which is exactly the
 * arrangement that manufactures an effect.
 *
 * Anthropic measured a **6 pp score gap (p<0.01)** between most- and least-resourced container configs with
 * model, harness and tasks held constant. On a thermally-limited laptop the equivalent confound is not a
 * container config — it is the clock.
 *
 * ── AN INFRA-ERROR RATE IS PART OF A SCORE, NOT A FOOTNOTE ──
 * Infra error rates of 5.8% / 2.1% / 0.5% were observed across enforcement levels. A score reported without one
 * is unfalsifiable: a 3 pp difference means nothing if one arm suffered twice the infrastructure failures, and
 * the reader cannot tell because the number does not carry it. So `summariseTrials` refuses to emit a score
 * without the rate beside it.
 */

export type Arm = "a" | "b";

/**
 * Build an ABBA-interleaved schedule for `pairs` paired trials.
 *
 * Each PAIR contributes A,B,B,A rather than the whole run being one long ABBA — a single ABBA over hundreds of
 * trials would leave long same-arm stretches in the middle, which is the sequential-block problem again at a
 * smaller scale. Repeating the motif keeps both arms interleaved throughout.
 */
export function buildAbbaSchedule(pairs: number): readonly Arm[] {
	const count = Math.max(0, Math.trunc(pairs));
	const schedule: Arm[] = [];
	for (let index = 0; index < count; index += 1) {
		// Alternate the motif's phase so the FIRST slot is not always A: otherwise arm A permanently owns the
		// coolest moment of every block, which is a small bias that survives any number of repetitions.
		schedule.push(...(index % 2 === 0 ? (["a", "b", "b", "a"] as const) : (["b", "a", "a", "b"] as const)));
	}
	return schedule;
}

export interface Trial {
	readonly arm: Arm;
	/** Position in execution order, 0-based. */
	readonly index: number;
	readonly passed: boolean;
	/** Wall time, used to detect drift rather than to score. */
	readonly durationMs: number;
	/** True when the trial failed for INFRASTRUCTURE reasons rather than on its merits. */
	readonly infraError?: boolean;
}

export interface DriftAssessment {
	/** Ratio of mean duration in the second half of the run to the first half. */
	readonly lateEarlyRatio: number;
	readonly drifting: boolean;
	readonly detail: string;
}

/** Late-half slowdown above this is treated as real drift rather than noise. OPERATIONAL DEFAULT (P18.5). */
export const DRIFT_RATIO_BAR = 1.15;

/**
 * Detect whether the machine slowed over the run.
 *
 * Reported even when the schedule is balanced. ABBA makes drift harmless to the COMPARISON, but drift is still
 * worth knowing about — it caps how long a session can run before the numbers stop meaning the same thing, and a
 * balanced design that silently hides a 40% slowdown is withholding something the operator needs.
 */
export function detectThermalDrift(trials: readonly Trial[]): DriftAssessment {
	const ordered = [...trials].sort((left, right) => left.index - right.index);
	if (ordered.length < 4) {
		return {
			lateEarlyRatio: 1,
			drifting: false,
			detail: "too few trials to see a trend — not evidence of stability, just absence of a measurement",
		};
	}
	const midpoint = Math.floor(ordered.length / 2);
	const mean = (slice: readonly Trial[]) =>
		slice.length === 0 ? 0 : slice.reduce((total, trial) => total + trial.durationMs, 0) / slice.length;
	const early = mean(ordered.slice(0, midpoint));
	const late = mean(ordered.slice(midpoint));
	const ratio = early > 0 ? late / early : 1;

	return {
		lateEarlyRatio: ratio,
		drifting: ratio >= DRIFT_RATIO_BAR,
		detail:
			ratio >= DRIFT_RATIO_BAR
				? `the second half ran ${((ratio - 1) * 100).toFixed(0)}% slower than the first — thermal drift is present. ABBA keeps it out of the COMPARISON, but it caps how long a session stays comparable`
				: `no material drift (late/early ${ratio.toFixed(2)})`,
	};
}

export interface TrialSummary {
	readonly armPassRate: Readonly<Record<Arm, number>>;
	readonly infraErrorRate: number;
	readonly balanced: boolean;
	readonly drift: DriftAssessment;
	readonly text: string;
}

/**
 * Summarise a completed A/B run.
 *
 * Infra errors are excluded from the pass rates AND reported as their own rate. Counting them as failures would
 * blame an arm for the machine; dropping them silently would hide that a comparison rested on fewer trials than
 * it appears to. Both halves are needed, which is why one number cannot carry this.
 */
export function summariseTrials(trials: readonly Trial[]): TrialSummary {
	const usable = trials.filter((trial) => trial.infraError !== true);
	const infraErrors = trials.length - usable.length;
	const rate = (arm: Arm) => {
		const armTrials = usable.filter((trial) => trial.arm === arm);
		return armTrials.length === 0 ? 0 : armTrials.filter((trial) => trial.passed).length / armTrials.length;
	};

	const countA = usable.filter((trial) => trial.arm === "a").length;
	const countB = usable.filter((trial) => trial.arm === "b").length;
	const balanced = countA === countB;
	const drift = detectThermalDrift(trials);

	const infraErrorRate = trials.length === 0 ? 0 : infraErrors / trials.length;

	return {
		armPassRate: { a: rate("a"), b: rate("b") },
		infraErrorRate,
		balanced,
		drift,
		text:
			trials.length === 0
				? "no trials — nothing to report, and an absent run must not render as a 0% score"
				: `A ${(rate("a") * 100).toFixed(0)}% (n=${countA}) vs B ${(rate("b") * 100).toFixed(0)}% (n=${countB}); infra-error rate ${(infraErrorRate * 100).toFixed(1)}%${
						balanced
							? ""
							: " ⚠️ UNBALANCED after dropping infra errors — one arm ran more trials, so the comparison is no longer paired"
					}. ${drift.detail}`,
	};
}
