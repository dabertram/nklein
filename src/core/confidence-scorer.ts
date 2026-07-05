/**
 * §5.AB / §5.K — calibrated-confidence scorer (pure core). After an attempt, several evidence signals say how much to
 * TRUST the result: the validity of the model's tool calls, whether the tests pass, the reviewer's verdict, and
 * self-consistency across samples. This combines them into a raw confidence, then maps it through a per-(model × role ×
 * task-shape) CALIBRATION curve — because a model's raw 0.8 may historically mean 0.6 correct, so the curve corrects
 * over-/under-confidence. The curve is LEARNED elsewhere (from observed outcome vs. predicted confidence); this applies
 * it. Pure + total + deterministic.
 */

/** The evidence signals available after an attempt (each optional + in [0,1]; absent signals are skipped). */
export interface ConfidenceEvidence {
	/** Fraction of the model's tool calls that were valid / well-formed. */
	toolCallValidity?: number;
	/** Fraction of the reproduction + regression tests passing after the work (strong evidence). */
	testPassRate?: number;
	/** The reviewer's verdict as a score (strong evidence). */
	reviewerVerdict?: number;
	/** Agreement across self-consistency samples. */
	selfConsistency?: number;
}

/** Signal weights (test pass + reviewer verdict dominate; tool validity + self-consistency support). Sum = 1. */
const SIGNAL_WEIGHTS: Record<keyof ConfidenceEvidence, number> = {
	testPassRate: 0.35,
	reviewerVerdict: 0.3,
	selfConsistency: 0.2,
	toolCallValidity: 0.15,
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Combine the AVAILABLE evidence signals into a raw confidence in [0,1] — a weighted mean over the signals that are
 * present (weights renormalized so absent signals don't drag the score toward 0). No evidence at all ⇒ 0.5 (unknown).
 */
export function combineConfidenceEvidence(evidence: ConfidenceEvidence): number {
	let weightedSum = 0;
	let weightTotal = 0;
	for (const key of Object.keys(SIGNAL_WEIGHTS) as (keyof ConfidenceEvidence)[]) {
		const value = evidence[key];
		if (value !== undefined && Number.isFinite(value)) {
			const weight = SIGNAL_WEIGHTS[key];
			weightedSum += clamp01(value) * weight;
			weightTotal += weight;
		}
	}
	return weightTotal === 0 ? 0.5 : clamp01(weightedSum / weightTotal);
}

/** A monotonic calibration mapping raw→calibrated confidence, learned per (model × role × task-shape). */
export interface CalibrationCurve {
	/** Anchor points; sorted by `raw` ascending internally. Empty ⇒ identity (no calibration data yet). */
	points: readonly { raw: number; calibrated: number }[];
}

/**
 * Map a raw confidence through a calibration curve (piecewise-linear interpolation between anchor points; clamped to
 * the endpoints outside the range). An empty/absent curve is the identity — an uncalibrated key returns its raw score.
 */
export function applyCalibration(raw: number, curve?: CalibrationCurve): number {
	const value = clamp01(raw);
	const points = [...(curve?.points ?? [])].sort((a, b) => a.raw - b.raw);
	if (points.length === 0) {
		return value;
	}
	const first = points[0];
	const last = points[points.length - 1];
	if (first === undefined || last === undefined) {
		return value;
	}
	if (value <= first.raw) {
		return clamp01(first.calibrated);
	}
	if (value >= last.raw) {
		return clamp01(last.calibrated);
	}
	for (let i = 0; i < points.length - 1; i += 1) {
		const lo = points[i];
		const hi = points[i + 1];
		if (lo && hi && value >= lo.raw && value <= hi.raw) {
			const span = hi.raw - lo.raw;
			const t = span === 0 ? 0 : (value - lo.raw) / span;
			return clamp01(lo.calibrated + t * (hi.calibrated - lo.calibrated));
		}
	}
	return value;
}

/** Full pipeline: combine the evidence into a raw confidence, then apply the (optional, per-key) calibration curve. */
export function scoreCalibratedConfidence(evidence: ConfidenceEvidence, curve?: CalibrationCurve): number {
	return applyCalibration(combineConfidenceEvidence(evidence), curve);
}
