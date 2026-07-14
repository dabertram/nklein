import type { ModelBehaviorProfile } from "./model-behavior-profile";

/**
 * F3.7 (pure core / a-leaf) — attempt-start model selection over the learned `ModelBehaviorProfile`s. Given the models
 * a routing decision could pick from, this PREFERS learned winners, SKIPS proven failures, DECAYS stale facts toward a
 * neutral prior (so an old strong/weak record never dominates a cold model), and EXPOSES a per-model rationale. Pure +
 * deterministic — the routing wiring (`routeNKleinTask`) and its live validation against real models are the b-leaf.
 *
 * Deliberately DISTINCT from `rankModelsByLedgerFitnessWithVerdict` (a DISPLAY recommendation that folds the runtime
 * verdict for the `nklein dev ledger` / browser surfaces): this is a routing-time preference with explicit skip + decay
 * semantics, reusing the SAME `ModelBehaviorProfile` primitives so the two never diverge on the underlying signal.
 */

/** A neutral success prior for unseen / fully-decayed models — halfway, so evidence pulls up OR down from here. */
const NEUTRAL_SUCCESS_PRIOR = 0.5;
const DEFAULT_MIN_SAMPLES_TO_JUDGE = 4;
const DEFAULT_PROVEN_FAILURE_RATE_CEILING = 0.2;
const DEFAULT_STALENESS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export interface AttemptModelCandidate {
	modelId: string;
	/** The model's learned profile, or null for a model with no recorded attempts yet (treated as a neutral prior). */
	profile: ModelBehaviorProfile | null;
}

export interface AttemptModelSelectionOptions {
	/** Current time (ms) — anchors staleness decay. Required so the core stays pure (no `Date.now()`). */
	now: number;
	/** Below this sample count a model is UNPROVEN — never skipped as a "proven failure", judged near-neutral. Default 4. */
	minSamplesToJudge?: number;
	/** A proven model whose EWMA success is below this (and is fresh enough to trust) is SKIPPED. Default 0.2. */
	provenFailureRateCeiling?: number;
	/** Profiles older than this decay toward the neutral prior (linearly, capped at fully-neutral at 2× the window). */
	stalenessWindowMs?: number;
	/** When set, a model whose learned complexity ceiling is below the task's tool count is skipped (can't handle it). */
	requiredToolCount?: number | null;
}

export interface AttemptModelRanking {
	modelId: string;
	/** Confidence-and-freshness-adjusted success expectation in [0,1] — the sort key (higher = preferred). */
	score: number;
	reason: string;
}

export interface AttemptModelSkip {
	modelId: string;
	reason: string;
}

export interface AttemptModelSelection {
	/** Preferred-first, skipped models excluded. Empty only when every candidate was skipped. */
	ordered: AttemptModelRanking[];
	skipped: AttemptModelSkip[];
	/** One-line human summary of the pick (for the ledger rationale / operator surface). */
	rationale: string;
}

/** Fraction in [0,1] of how much a profile's evidence is trusted given age: 1 fresh, 0 at ≥2× the staleness window. */
function freshnessFactor(ageMs: number, windowMs: number): number {
	if (ageMs <= windowMs) {
		return 1;
	}
	if (ageMs >= windowMs * 2) {
		return 0;
	}
	// Linear decay across the [window, 2×window] band.
	return 1 - (ageMs - windowMs) / windowMs;
}

/** Confidence in [0,1] from sample count — ramps to full trust at `minSamplesToJudge`, so a 1-sample model stays humble. */
function sampleConfidence(samples: number, minSamples: number): number {
	if (minSamples <= 0) {
		return 1;
	}
	return Math.min(1, samples / minSamples);
}

export function selectModelForAttempt(
	candidates: readonly AttemptModelCandidate[],
	options: AttemptModelSelectionOptions,
): AttemptModelSelection {
	const minSamples = options.minSamplesToJudge ?? DEFAULT_MIN_SAMPLES_TO_JUDGE;
	const failureCeiling = options.provenFailureRateCeiling ?? DEFAULT_PROVEN_FAILURE_RATE_CEILING;
	const stalenessWindowMs = options.stalenessWindowMs ?? DEFAULT_STALENESS_WINDOW_MS;
	const requiredToolCount = options.requiredToolCount ?? null;

	const ordered: AttemptModelRanking[] = [];
	const skipped: AttemptModelSkip[] = [];

	for (const candidate of candidates) {
		const profile = candidate.profile;
		if (!profile || profile.samples === 0) {
			// Unseen model: a neutral prior so it competes fairly and gets a chance to build evidence (safe exploration).
			ordered.push({
				modelId: candidate.modelId,
				score: NEUTRAL_SUCCESS_PRIOR,
				reason: "unproven (no history) — neutral prior",
			});
			continue;
		}
		const fresh = freshnessFactor(options.now - profile.updatedAt, stalenessWindowMs);
		const confidence = sampleConfidence(profile.samples, minSamples) * fresh;
		const proven = profile.samples >= minSamples && fresh > 0.5;

		// Skip a PROVEN failure — enough fresh samples AND an EWMA success below the floor. An unproven or stale-decayed
		// model is never skipped on rate alone (it just scores near-neutral), so a cold fleet always has a runway.
		if (proven && profile.successRate < failureCeiling) {
			skipped.push({
				modelId: candidate.modelId,
				reason: `proven failure — ${Math.round(profile.successRate * 100)}% success over ${profile.samples} attempt(s)`,
			});
			continue;
		}
		// Skip a model that can't structurally handle the task's tool surface (its learned complexity ceiling is below it).
		if (
			requiredToolCount !== null &&
			profile.complexityCeiling !== null &&
			profile.complexityCeiling < requiredToolCount
		) {
			skipped.push({
				modelId: candidate.modelId,
				reason: `below complexity ceiling — cleared ${profile.complexityCeiling} tool(s), task needs ${requiredToolCount}`,
			});
			continue;
		}
		// Decay toward the neutral prior by confidence: a high-confidence winner keeps its rate; a thin or stale record
		// regresses toward 0.5, so it neither over-trusts a lucky streak nor over-punishes an old miss.
		const score = NEUTRAL_SUCCESS_PRIOR + (profile.successRate - NEUTRAL_SUCCESS_PRIOR) * confidence;
		const staleNote = fresh < 1 ? `, stale×${fresh.toFixed(2)}` : "";
		ordered.push({
			modelId: candidate.modelId,
			score,
			reason: `${Math.round(profile.successRate * 100)}% over ${profile.samples} (conf ${confidence.toFixed(2)}${staleNote})`,
		});
	}

	// Preferred first; stable on ties (preserve input order) so the pick is deterministic run to run.
	ordered.sort((left, right) => right.score - left.score);

	const rationale =
		ordered.length === 0
			? `all ${skipped.length} candidate(s) skipped as proven-unfit`
			: `picked ${ordered[0]?.modelId} (${ordered[0]?.reason})${skipped.length > 0 ? `; skipped ${skipped.length}` : ""}`;

	return { ordered, skipped, rationale };
}
