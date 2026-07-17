/**
 * LLM-judge calibration + bias harness (F12.50) — PURE core.
 *
 * !Klein's review/gate judges are uncalibrated: raw judge↔human agreement inflates under pass-heavy imbalance (a judge
 * that always says "pass" agrees 90% on a 90%-pass set), and small local models judging peers carry position,
 * verbosity, and self-enhancement biases. This core is the measurement math over a labeled trial set: Cohen's kappa
 * (chance-corrected agreement) + the three bias probes + PoLL jury aggregation with disagreement flagged for human
 * review. Pure and deterministic — the gold labels are data the caller supplies; nothing here calls a model.
 */

export interface JudgeTrial {
	/** The judge's binary verdict (pass/accept = true). */
	readonly judgeVerdict: boolean;
	/** The human gold label for the same case. */
	readonly humanVerdict: boolean;
}

export interface KappaReport {
	readonly trials: number;
	/** Raw agreement rate (inflates under class imbalance — report, never headline). */
	readonly rawAgreement: number;
	/** Cohen's kappa: chance-corrected agreement; ≤0 = no better than chance. Null when undefined (degenerate marginals). */
	readonly kappa: number | null;
	readonly interpretation: string;
}

/** Judge↔human chance-corrected agreement. Kappa is null when both raters are constant (chance agreement = 1). */
export function cohenKappa(trials: readonly JudgeTrial[]): KappaReport {
	if (trials.length === 0) {
		return { trials: 0, rawAgreement: 0, kappa: null, interpretation: "no trials — nothing to calibrate." };
	}
	const n = trials.length;
	const agree = trials.filter((trial) => trial.judgeVerdict === trial.humanVerdict).length / n;
	const judgePass = trials.filter((trial) => trial.judgeVerdict).length / n;
	const humanPass = trials.filter((trial) => trial.humanVerdict).length / n;
	const chance = judgePass * humanPass + (1 - judgePass) * (1 - humanPass);
	const kappa = chance === 1 ? null : (agree - chance) / (1 - chance);
	const interpretation =
		kappa === null
			? "degenerate marginals (a constant rater) — kappa undefined; collect a more balanced gold set."
			: kappa < 0.2
				? "judge is near-chance — do not gate on this judge."
				: kappa < 0.4
					? "fair agreement — advisory only."
					: kappa < 0.6
						? "moderate agreement — usable with human spot-checks."
						: "substantial agreement — gate-grade.";
	return { trials: n, rawAgreement: agree, kappa, interpretation };
}

/** One A/B comparison run BOTH ways (candidates swapped) — the position-bias probe unit. */
export interface PositionBiasTrial {
	/** Which candidate won when presented (A first, B second). */
	readonly firstOrderWinner: "a" | "b";
	/** Which candidate won when the SAME pair was presented swapped (B first, A second). */
	readonly swappedOrderWinner: "a" | "b";
}

export interface PositionBiasReport {
	readonly pairs: number;
	/** Pairs where the verdict flipped with presentation order (the winner tracked position, not content). */
	readonly positionTracked: number;
	readonly positionTrackedRate: number;
	readonly biased: boolean;
}

/** Position bias: rate of verdicts that follow presentation order rather than content (>25% flags the judge). */
export function probePositionBias(trials: readonly PositionBiasTrial[]): PositionBiasReport {
	const tracked = trials.filter((trial) => trial.firstOrderWinner !== trial.swappedOrderWinner).length;
	const rate = trials.length === 0 ? 0 : tracked / trials.length;
	return { pairs: trials.length, positionTracked: tracked, positionTrackedRate: rate, biased: rate > 0.25 };
}

export interface VerbosityBiasTrial {
	readonly judgeVerdict: boolean;
	/** Length (chars or tokens — any consistent unit) of the judged response. */
	readonly responseLength: number;
}

export interface VerbosityBiasReport {
	readonly trials: number;
	/** Point-biserial correlation between verdict and length (−1..1); null when undefined (constant column). */
	readonly correlation: number | null;
	readonly biased: boolean;
}

/** Verbosity bias: point-biserial correlation verdict↔length; |r| > 0.3 flags length-following judging. */
export function probeVerbosityBias(trials: readonly VerbosityBiasTrial[]): VerbosityBiasReport {
	if (trials.length < 2) {
		return { trials: trials.length, correlation: null, biased: false };
	}
	const n = trials.length;
	const meanLength = trials.reduce((sum, trial) => sum + trial.responseLength, 0) / n;
	const passShare = trials.filter((trial) => trial.judgeVerdict).length / n;
	const stdLength = Math.sqrt(trials.reduce((sum, trial) => sum + (trial.responseLength - meanLength) ** 2, 0) / n);
	if (stdLength === 0 || passShare === 0 || passShare === 1) {
		return { trials: n, correlation: null, biased: false };
	}
	const meanPassLength =
		trials.filter((trial) => trial.judgeVerdict).reduce((sum, trial) => sum + trial.responseLength, 0) /
		trials.filter((trial) => trial.judgeVerdict).length;
	const meanFailLength =
		trials.filter((trial) => !trial.judgeVerdict).reduce((sum, trial) => sum + trial.responseLength, 0) /
		trials.filter((trial) => !trial.judgeVerdict).length;
	const correlation = ((meanPassLength - meanFailLength) / stdLength) * Math.sqrt(passShare * (1 - passShare));
	return { trials: n, correlation, biased: Math.abs(correlation) > 0.3 };
}

export interface SelfEnhancementTrial {
	readonly judgeVerdict: boolean;
	/** Whether the judged output came from the judge's own model family. */
	readonly ownFamily: boolean;
}

export interface SelfEnhancementReport {
	readonly ownFamilyTrials: number;
	readonly otherFamilyTrials: number;
	readonly ownFamilyPassRate: number | null;
	readonly otherFamilyPassRate: number | null;
	/** ownRate − otherRate; > 0.15 flags self-enhancement. Null when either side is empty. */
	readonly gap: number | null;
	readonly biased: boolean;
}

/** Self-enhancement: pass-rate gap for own-family vs other-family outputs (>15 points flags the judge). */
export function probeSelfEnhancement(trials: readonly SelfEnhancementTrial[]): SelfEnhancementReport {
	const own = trials.filter((trial) => trial.ownFamily);
	const other = trials.filter((trial) => !trial.ownFamily);
	const ownRate = own.length === 0 ? null : own.filter((trial) => trial.judgeVerdict).length / own.length;
	const otherRate = other.length === 0 ? null : other.filter((trial) => trial.judgeVerdict).length / other.length;
	const gap = ownRate === null || otherRate === null ? null : ownRate - otherRate;
	return {
		ownFamilyTrials: own.length,
		otherFamilyTrials: other.length,
		ownFamilyPassRate: ownRate,
		otherFamilyPassRate: otherRate,
		gap,
		biased: gap !== null && gap > 0.15,
	};
}

export interface JuryVote {
	readonly judgeId: string;
	/** Model family, to surface the correlated-error ceiling when the jury is same-family. */
	readonly family: string;
	readonly verdict: boolean;
}

export interface JuryVerdict {
	readonly verdict: boolean;
	readonly votesFor: number;
	readonly votesAgainst: number;
	/** Any dissent flags the case for human review (PoLL discipline: unanimity is the cheap confidence signal). */
	readonly disagreement: boolean;
	/** Same-family juries share failure modes — agreement then overstates confidence. */
	readonly correlatedFamilies: boolean;
	readonly note: string;
}

/** PoLL jury: majority vote; dissent → human review; same-family jury → correlated-error warning. */
export function aggregateJury(votes: readonly JuryVote[]): JuryVerdict {
	const votesFor = votes.filter((vote) => vote.verdict).length;
	const votesAgainst = votes.length - votesFor;
	const disagreement = votesFor > 0 && votesAgainst > 0;
	const families = new Set(votes.map((vote) => vote.family));
	const correlatedFamilies = votes.length > 1 && families.size === 1;
	return {
		verdict: votesFor > votesAgainst,
		votesFor,
		votesAgainst,
		disagreement,
		correlatedFamilies,
		note: disagreement
			? `split ${votesFor}–${votesAgainst} — flag for human review.`
			: correlatedFamilies
				? "unanimous, but all jurors share one model family — correlated errors cap this confidence."
				: "unanimous across families.",
	};
}
