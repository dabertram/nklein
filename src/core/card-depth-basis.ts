/**
 * P25.3 phase 4 — derive the `neededDepth` a card's model selection should be judged against.
 *
 * `assignModelFromFitness` takes a bare `ContextDepthBucket`, and `fitnessDepthMismatch` treats it as a FACT:
 * a card declared `deep` will only accept deep-measured evidence. That asymmetry is deliberate and right — but
 * it means handing the decider a guess converts a guess into a requirement (or, worse in the other direction,
 * into a permission). Depth is measured AFTER a session runs, and selection happens BEFORE, so the naive move
 * is to estimate one and pass it silently. That is the green-signal substitution this codebase keeps finding.
 *
 * So this returns the depth WITH ITS BASIS, and callers decide whether that basis is strong enough to steer on:
 *
 *   measured     a PRIOR ATTEMPT of this same card recorded its context tokens. Not an estimate at all — the
 *                card has run, and re-work is the case where selection matters most.
 *   lower_bound  the seed prompt ALONE already exceeds a band boundary. A session's context can only grow from
 *                its seed, so this is arithmetic, not prediction: a 20k-token seed cannot produce a shallow
 *                session.
 *   unknown      a first attempt with a small seed. The session could stay shallow or grow deep, and nothing
 *                available says which. Reported as unknown rather than defaulted, because both defaults are
 *                wrong in an expensive way: defaulting `shallow` lets a model validated only on shallow work
 *                take a deep card (the exact error P22.2 names), and defaulting `deep` silently demands
 *                deep-measured evidence the fitness store rarely has, so every assignment abstains for a reason
 *                that looks like missing data rather than a manufactured requirement.
 */

import { type ContextDepthBucket, classifyContextDepth, SHALLOW_DEPTH_MAX_TOKENS } from "./model-fitness-freshness";

export type CardDepthBasis = "measured" | "lower_bound" | "unknown";

export interface CardDepthEstimate {
	/** Null ONLY when `basis` is `unknown` — an unknown depth is not representable as a bucket. */
	readonly depth: ContextDepthBucket | null;
	readonly basis: CardDepthBasis;
	/** Why this basis, in the terms a routing log should record. */
	readonly detail: string;
}

export interface PriorAttemptContext {
	/** Context tokens the attempt actually used. Absent/non-finite on attempts recorded before depth tracking. */
	readonly usedContextTokens?: number | null;
}

/**
 * Derive the depth a card should be judged at, and say how strongly.
 *
 * `seedPromptTokens` is the token count of the prompt the session will START with — the card text, its brief,
 * and any attached context. Callers that cannot count it should pass 0 rather than a guess.
 */
export function deriveCardDepth(input: {
	readonly priorAttempts?: readonly PriorAttemptContext[];
	readonly seedPromptTokens?: number;
}): CardDepthEstimate {
	// A prior attempt is a MEASUREMENT of this card, not a proxy for it. The deepest observed attempt is the one
	// that matters: a card that once needed 20k tokens can need them again, and picking the shallowest (or the
	// most recent) would let a single cheap attempt understate a card that has already proven otherwise.
	const observed = (input.priorAttempts ?? [])
		.map((attempt) => attempt.usedContextTokens)
		.filter((tokens): tokens is number => typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0);
	if (observed.length > 0) {
		const deepest = Math.max(...observed);
		return {
			depth: classifyContextDepth(deepest),
			basis: "measured",
			detail: `a prior attempt of this card used ${deepest} context tokens`,
		};
	}

	// The seed is a FLOOR: a session's context includes its seed and only grows. So a seed past a band boundary
	// settles the band from below. It can never rule a card shallow — a small seed says nothing about where the
	// session ends up, which is exactly why the `unknown` case below exists.
	const seedTokens = Number.isFinite(input.seedPromptTokens) ? Math.max(0, input.seedPromptTokens ?? 0) : 0;
	if (seedTokens >= SHALLOW_DEPTH_MAX_TOKENS) {
		return {
			depth: classifyContextDepth(seedTokens),
			basis: "lower_bound",
			detail: `the seed prompt alone is ${seedTokens} tokens, so the session cannot be shallower than this`,
		};
	}

	return {
		depth: null,
		basis: "unknown",
		detail:
			"first attempt with a small seed prompt — nothing available says whether this card stays shallow or grows deep",
	};
}

/**
 * Whether an estimate is strong enough to drive model selection.
 *
 * Both `measured` and `lower_bound` are facts about this card. `unknown` is not, and the caller must abstain
 * rather than pick a bucket — the whole point of separating basis from depth.
 */
export function canSteerOnDepth(estimate: CardDepthEstimate): estimate is CardDepthEstimate & {
	depth: ContextDepthBucket;
} {
	return estimate.depth !== null && estimate.basis !== "unknown";
}
