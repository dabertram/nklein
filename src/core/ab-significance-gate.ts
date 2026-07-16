/**
 * A/B significance gate (F12.41) — PURE decision core.
 *
 * !Klein flips defaults (test-driven mode, durable scheduler, delivery-taint enforcement, scaffolding tweaks) after an
 * eval looks "green". But research is blunt: a ~100-case eval only resolves ~15-percentage-point deltas — most tweaks
 * flipped on eyeballed-green are WITHIN NOISE. This core replaces "green ⇒ flip" with a POWERED comparison: run both arms
 * on the SAME task set (paired outcomes), apply McNemar's exact test on the discordant pairs, and only recommend the flip
 * when the candidate is significantly AND practically better. Pure/total/deterministic — no I/O, no clock, no RNG.
 *
 * McNemar (not a two-proportion z-test) because the arms are PAIRED — run on the same tasks — so only the pairs where the
 * arms DISAGREE carry signal. The exact binomial form is used (correct at any sample size; the chi-square approximation is
 * unreliable when discordant pairs are few, exactly the small-eval regime we care about); a normal approximation kicks in
 * only for very large discordant counts where the exact sum would be needlessly expensive.
 */

/** One task run under both arms: `a` = baseline/current success, `b` = candidate success. */
export interface PairedOutcome {
	readonly a: boolean;
	readonly b: boolean;
}

export interface McNemarResult {
	/** Pairs where A succeeded but B failed (candidate made it WORSE). */
	readonly worse: number;
	/** Pairs where A failed but B succeeded (candidate made it BETTER). */
	readonly better: number;
	/** Two-sided p-value that the discordance is chance (H0: better/worse are 50/50). */
	readonly pValue: number;
	/** True when pValue < alpha — the difference is unlikely to be noise. */
	readonly significant: boolean;
}

export interface WilsonInterval {
	readonly point: number;
	readonly low: number;
	readonly high: number;
}

// --- numerical helpers (self-contained; no stats dependency) -------------------------------------------------------

/** Lanczos log-gamma; accurate to ~1e-10 for x > 0 — used for exact binomial coefficients in log space. */
function logGamma(x: number): number {
	const g = 7;
	const c = [
		0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
		12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
	];
	if (x < 0.5) {
		return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
	}
	const z = x - 1;
	let a = c[0] as number;
	const t = z + g + 0.5;
	for (let i = 1; i < g + 2; i++) {
		a += (c[i] as number) / (z + i);
	}
	return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function logChoose(n: number, k: number): number {
	return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/** Standard normal CDF via erf (Abramowitz-Stegun 7.1.26 approximation). */
function normalCdf(z: number): number {
	const sign = z < 0 ? -1 : 1;
	const x = Math.abs(z) / Math.SQRT2;
	const t = 1 / (1 + 0.3275911 * x);
	const y =
		1 -
		((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
			t *
			Math.exp(-x * x);
	return 0.5 * (1 + sign * y);
}

/** Two-sided McNemar p-value from discordant counts (exact binomial; normal-approx only for very large n). */
function mcnemarPValue(better: number, worse: number): number {
	const n = better + worse;
	if (n === 0) {
		return 1; // no discordance ⇒ no evidence of a difference
	}
	const k = Math.min(better, worse);
	if (n > 2000) {
		// Exact sum is wasteful here; the normal approximation is excellent at this scale (continuity-corrected).
		const z = (Math.abs(better - worse) - 1) / Math.sqrt(n);
		return Math.min(1, 2 * (1 - normalCdf(Math.max(0, z))));
	}
	const lnHalfN = n * Math.log(0.5);
	let tail = 0;
	for (let i = 0; i <= k; i++) {
		tail += Math.exp(logChoose(n, i) + lnHalfN);
	}
	return Math.min(1, 2 * tail);
}

/** McNemar's paired test on a set of paired outcomes. */
export function mcnemarTest(pairs: readonly PairedOutcome[], alpha = 0.05): McNemarResult {
	let worse = 0;
	let better = 0;
	for (const pair of pairs) {
		if (pair.a && !pair.b) {
			worse += 1;
		} else if (!pair.a && pair.b) {
			better += 1;
		}
	}
	const pValue = mcnemarPValue(better, worse);
	return { worse, better, pValue, significant: pValue < alpha };
}

/** Wilson score interval for a binomial proportion — better than normal-approx at the extremes / small n. */
export function wilsonInterval(successes: number, n: number, z = 1.96): WilsonInterval {
	if (n === 0) {
		return { point: 0, low: 0, high: 1 };
	}
	const phat = successes / n;
	const z2 = z * z;
	const denom = 1 + z2 / n;
	const center = (phat + z2 / (2 * n)) / denom;
	const margin = (z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n))) / denom;
	return { point: phat, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export interface FlipDecisionInput {
	/** Paired per-task outcomes of the two arms on the SAME task set. */
	readonly pairs: readonly PairedOutcome[];
	/** Significance level (default 0.05). */
	readonly alpha?: number;
	/** Minimum PRACTICAL success-rate improvement required (default 0 — any significant improvement). */
	readonly minEffect?: number;
}

export interface FlipDecision {
	readonly flip: boolean;
	readonly aRate: number;
	readonly bRate: number;
	readonly delta: number;
	readonly mcnemar: McNemarResult;
	readonly reason: string;
}

/**
 * Decide whether to flip a default from arm A (current) to arm B (candidate). Flips ONLY when the candidate's success rate
 * beats the baseline by at least `minEffect` AND McNemar says that improvement is unlikely to be noise. A candidate that is
 * merely non-inferior, or better only within the noise band, does NOT flip — the whole point is to stop flipping on an
 * eyeballed-green eval that can't resolve the delta.
 */
export function decideDefaultFlip(input: FlipDecisionInput): FlipDecision {
	const { pairs, alpha = 0.05, minEffect = 0 } = input;
	const n = pairs.length;
	const aSucc = pairs.filter((p) => p.a).length;
	const bSucc = pairs.filter((p) => p.b).length;
	const aRate = n === 0 ? 0 : aSucc / n;
	const bRate = n === 0 ? 0 : bSucc / n;
	const delta = bRate - aRate;
	const mcnemar = mcnemarTest(pairs, alpha);

	if (n === 0) {
		return { flip: false, aRate, bRate, delta, mcnemar, reason: "no paired outcomes — cannot decide." };
	}
	if (delta < minEffect) {
		return {
			flip: false,
			aRate,
			bRate,
			delta,
			mcnemar,
			reason: `candidate improvement ${(delta * 100).toFixed(1)}pp is below the required ${(minEffect * 100).toFixed(1)}pp effect.`,
		};
	}
	if (!mcnemar.significant) {
		return {
			flip: false,
			aRate,
			bRate,
			delta,
			mcnemar,
			reason: `improvement is within noise: McNemar p=${mcnemar.pValue.toFixed(3)} ≥ ${alpha} (${mcnemar.better} better / ${mcnemar.worse} worse of ${n}); need a larger eval or effect.`,
		};
	}
	return {
		flip: true,
		aRate,
		bRate,
		delta,
		mcnemar,
		reason: `flip: candidate +${(delta * 100).toFixed(1)}pp, significant (McNemar p=${mcnemar.pValue.toFixed(3)} < ${alpha}, ${mcnemar.better} better vs ${mcnemar.worse} worse).`,
	};
}
