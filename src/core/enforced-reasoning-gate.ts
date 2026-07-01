/**
 * Enforced-reasoning gate + kind selector (todo §5.AD) — decide WHETHER to bounce a model through a reasoning loop,
 * WHICH KIND to use, and HOW MANY rounds to allow, before spending any model calls on it.
 *
 * Research (background, see todo.md §5.AD): weak models are lifted robustly by **enforced reasoning** — multi-agent
 * **debate / cross-model bounce** (a stronger agent carries a weaker one in ~1 round) — but **intrinsic self-correction
 * often does NOT help and can HURT** (Huang et al. 2023). So the policy is (a) **gate on difficulty + observed
 * struggle** (don't tax a robust model on an easy task, and don't self-correct with no external signal), (b) prefer an
 * **EXTERNAL signal** (a different model, then variance-washing self-consistency, then a *varied* persona — never a bare
 * "are you sure?"), and (c) **bound the rounds** (reuse the §5.K round-limit + §5.S no-progress discipline). This module
 * is the pure decision core; the effectful loop (firing the chosen kind at the model-call seam, reusing the §5.K
 * reviewer seam / §5.AA prompt-variation / the `self-consistency` majority-vote) is layered on top later.
 *
 * Complements `retry-policy.ts` (§5.AA — which failure-mode ladder RUNG to try next) and reads the same §5.AA
 * `ModelBehaviorProfile` reliability signals: `retry-policy` answers "what next after a failure"; this answers "should
 * this turn reason harder, and how" — a difficulty/reliability gate that runs BEFORE (or alongside) the ladder.
 */

import { dominantFailureMode, type ModelBehaviorProfile } from "./model-behavior-profile";

/**
 * The kind of enforced reasoning to run, external-signal-first (strongest signal first):
 * - `cross_model_carry` — a stronger loaded peer critiques/repairs this model's draft (the strongest external signal).
 * - `self_consistency` — sample N paths from THIS model + majority-vote (washes out a flaky model's variance; no peer).
 * - `self_bounce_varied` — bounce the model against itself under a *varied* persona/prompt (weak, deterministic model,
 *   no peer) — explicitly NOT a bare self-critique ("are you sure?"), which the research shows can hurt.
 * - `none` — the gate is not met; run the model once as normal.
 */
export type EnforcedReasoningKind = "cross_model_carry" | "self_consistency" | "self_bounce_varied" | "none";

export interface EnforcedReasoningInput {
	/** Task difficulty as a 0..1 score (from §5.AB `estimateTaskDifficulty`). Higher = harder. */
	difficulty: number;
	/** True when THIS task has already failed/bounced at least once (a review rejection, restart, timeout, …). */
	observedFailure?: boolean;
	/** The §5.AA learned behaviour profile for the model in play (its reliability + dominant failure mode). Optional — a
	 *  cold-start model has none, so the gate leans on difficulty + `observedFailure` alone. */
	profile?: ModelBehaviorProfile;
	/** True when a DISTINCT, stronger loaded model is available to carry this one (enables `cross_model_carry`). */
	strongerPeerAvailable?: boolean;
	/** Difficulty at/above which a reasoning loop is worth its cost (default 0.6 — the section's "high difficulty"). */
	difficultyThreshold?: number;
	/** Learned success rate at/below which the model counts as "struggling" even without a fresh failure (default 0.6). */
	reliabilityFloor?: number;
	/** Min samples before the profile's success rate is trusted as a struggle signal (default 3 — avoid cold-start noise). */
	minSamplesForReliability?: number;
	/** Hard ceiling on rounds so a stuck loop always terminates (default 3 — the §5.K bound). */
	maxRounds?: number;
}

export interface EnforcedReasoningDecision {
	/** Whether to run an enforced reasoning loop at all. */
	enforce: boolean;
	/** The selected loop kind (`none` iff `enforce` is false). */
	kind: EnforcedReasoningKind;
	/** How many rounds the loop may run (0 when not enforcing) — bounded, always terminating. */
	rounds: number;
	/** Inspectable reason (for the §5.AG "what was tried" surface + the §5.AF ledger). */
	reason: string;
}

const DEFAULT_DIFFICULTY_THRESHOLD = 0.6;
const DEFAULT_RELIABILITY_FLOOR = 0.6;
const DEFAULT_MIN_SAMPLES = 3;
const DEFAULT_MAX_ROUNDS = 3;

function clamp01(value: number): number {
	if (Number.isNaN(value)) {
		return 0;
	}
	return Math.min(1, Math.max(0, value));
}

/**
 * Whether the model's LEARNED reliability marks it as "struggling" (an external struggle signal that doesn't need a
 * fresh failure this task). Only trusted once the profile has enough samples — a cold/near-cold profile is not evidence.
 */
function isLowReliability(profile: ModelBehaviorProfile | undefined, floor: number, minSamples: number): boolean {
	if (!profile || profile.samples < minSamples) {
		return false;
	}
	return profile.successRate <= floor;
}

/**
 * The number of rounds to allow: bounded by task difficulty (harder ⇒ up to the ceiling) and always ≥1 when enforcing,
 * ≤ the hard ceiling so the loop always terminates. A `self_consistency` loop still gets ≥1 (it samples within a round).
 */
function roundsForDifficulty(difficulty: number, maxRounds: number): number {
	const ceiling = Math.max(1, Math.trunc(maxRounds));
	const scaled = Math.ceil(clamp01(difficulty) * ceiling);
	return Math.max(1, Math.min(ceiling, scaled));
}

/**
 * Pick the enforced-reasoning KIND once the gate is met, external-signal-first:
 * 1. a stronger loaded peer ⇒ `cross_model_carry` (the strongest external signal);
 * 2. else a FLAKY model (low reliability OR a stochastic dominant failure mode — `loop`/`no_tool_call`/`narrated`) ⇒
 *    `self_consistency` (majority-vote washes out variance);
 * 3. else ⇒ `self_bounce_varied` (a varied persona — the weakest external-ish signal, but never a bare self-critique).
 */
function selectKind(input: EnforcedReasoningInput, lowReliability: boolean): Exclude<EnforcedReasoningKind, "none"> {
	if (input.strongerPeerAvailable) {
		return "cross_model_carry";
	}
	const dominant = input.profile ? dominantFailureMode(input.profile) : null;
	const stochastic = dominant === "loop" || dominant === "no_tool_call" || dominant === "narrated";
	if (lowReliability || stochastic) {
		return "self_consistency";
	}
	return "self_bounce_varied";
}

/**
 * Decide whether to enforce a reasoning loop for this turn, which kind, and how many rounds — the pure §5.AD gate.
 *
 * The gate is met when the task is HARD ENOUGH (`difficulty ≥ difficultyThreshold`) AND there is EXTERNAL evidence of
 * struggle (a failure/bounce already happened this task, OR the model's learned reliability is at/below the floor). When
 * either condition is missing it returns `none` — a robust model on an easy task, or any model with no struggle signal,
 * runs once as normal (self-correcting with no external signal tends to hurt). Pure + deterministic.
 */
export function decideEnforcedReasoning(input: EnforcedReasoningInput): EnforcedReasoningDecision {
	const threshold = input.difficultyThreshold ?? DEFAULT_DIFFICULTY_THRESHOLD;
	const floor = input.reliabilityFloor ?? DEFAULT_RELIABILITY_FLOOR;
	const minSamples = input.minSamplesForReliability ?? DEFAULT_MIN_SAMPLES;
	const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;
	const difficulty = clamp01(input.difficulty);

	if (difficulty < threshold) {
		return {
			enforce: false,
			kind: "none",
			rounds: 0,
			reason: `Difficulty ${difficulty.toFixed(2)} < threshold ${threshold.toFixed(2)} — reasoning loop not worth its cost.`,
		};
	}

	const lowReliability = isLowReliability(input.profile, floor, minSamples);
	const hasStruggleSignal = input.observedFailure === true || lowReliability;
	if (!hasStruggleSignal) {
		return {
			enforce: false,
			kind: "none",
			rounds: 0,
			reason: `Difficulty ${difficulty.toFixed(2)} ≥ threshold but no struggle signal (no failure this task, reliability above floor) — self-correction with no external signal tends to hurt; running once.`,
		};
	}

	const kind = selectKind(input, lowReliability);
	const rounds = roundsForDifficulty(difficulty, maxRounds);
	const trigger = input.observedFailure === true ? "an observed failure this task" : "low learned reliability";
	return {
		enforce: true,
		kind,
		rounds,
		reason: `Difficulty ${difficulty.toFixed(2)} ≥ threshold ${threshold.toFixed(2)} with ${trigger} ⇒ ${kind} for up to ${rounds} round(s).`,
	};
}
