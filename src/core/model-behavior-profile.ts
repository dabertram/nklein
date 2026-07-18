/**
 * Per-model behavioural learning profile (todo §5.AA) — "!Klein learns to use each model to its best".
 *
 * The user's directive: !Klein should LEARN, per connected model, what works and what doesn't — the tool-call format
 * it emits, the task complexity it can handle, its failure modes, its stochastic reliability, a sensible retry budget,
 * and (§5.AD) the context budget past which its output quality degrades — then ADAPT (pick the best first approach,
 * skip approaches known to fail, retry enough to ride out flakiness) and PERSIST these learnings globally so failures
 * + retries shrink over time. This module is the pure learning core: an online update from each attempt's outcome and
 * the derived signals the §5.AA retry engine + the §5.AB scheduler + the §5.AD budget read. It is deliberately
 * persistence-free (a thin JSON store in the runtime home wraps it when the consumers wire it, mirroring the MCSR) so
 * the learning logic stays pure + fully unit-testable.
 *
 * Complements the MCSR (§6.4 capability/speed registry) and the in-memory `ModelFitnessRecord` (§5.AB selection): the
 * MCSR measures how FAST/capable a model is; this profile learns how to GET THE MOST out of it.
 */

import { LOCAL_MODEL_ENDPOINT_LADDER, type LocalModelEndpointKind } from "./local-model-endpoint-strategy";

/** The classified outcome of one attempt to drive a model through a task/turn. */
export type ModelOutcomeKind =
	| "success"
	| "no_tool_call"
	| "narrated"
	| "loop"
	| "timeout"
	| "malformed"
	// A no-output `aborted` end from the SDK/agent loop with no !Klein timeout firing (§5.AA, root-caused 2026-06-28):
	// a TRANSIENT (a slow model's request likely hit an SDK/endpoint-level timeout or iteration boundary), evidenced by
	// the same task completing cleanly on a longer retest. Kept distinct from `other_failure`/`timeout` so it neither
	// pollutes the model's hard-failure profile nor counts toward hard-stuck — it should be re-run, not parked.
	| "aborted"
	| "other_failure";

/** The non-success failure modes (everything except `success`). */
export const MODEL_FAILURE_KINDS: readonly ModelOutcomeKind[] = [
	"no_tool_call",
	"narrated",
	"loop",
	"timeout",
	"malformed",
	"aborted",
	"other_failure",
];

export interface ModelAttemptOutcome {
	kind: ModelOutcomeKind;
	/** Retries it took THIS attempt before the outcome (0 = first try). Feeds the learned retry budget. */
	retries?: number;
	/** Context tokens in play for this attempt — anchors the §5.AD quality-effective budget. */
	contextTokens?: number;
	/** Whether output quality cleared the role/difficulty bar at that context size (§5.AD knee). */
	qualityOk?: boolean;
	/** The tool-call format observed (e.g. `native` / `narrated` / `phi` / `deepseek`) — learned per model. */
	toolCallFormat?: string;
	/** How many tools were offered this attempt — anchors the §5.AA complexity ceiling. */
	toolCount?: number;
	/** The prompt-variant FAMILY whose re-phrasing produced the winning call (§5.AA prompt-variation rung) —
	 *  counted only on success, so the profile learns which phrasing each model responds to. */
	promptVariantFamily?: string;
	/** The endpoint wire-protocol KIND that produced the winning call (§5.AB endpoint-iteration) — counted only on
	 *  success, so the profile learns which protocol (openai / native_v1_chat / anthropic_messages) each model
	 *  responds to, and the strategy tries it first next time. */
	winningEndpointKind?: string;
}

export interface ModelBehaviorProfile {
	modelId: string;
	samples: number;
	successes: number;
	/** EWMA success rate (0..1) — the stochastic-reliability signal. */
	successRate: number;
	/** EWMA retries-before-outcome — the basis of the learned retry budget. */
	avgRetries: number;
	/** Per-kind failure counts (success excluded; the `success` slot stays 0). */
	failureModes: Record<ModelOutcomeKind, number>;
	/** Counts of each tool-call format seen on SUCCESS — the mode is the model's preferred format. */
	toolCallFormatCounts: Record<string, number>;
	/** Counts of each prompt-variant family that WON a recovery (§5.AA) — the mode is tried first next time. */
	promptVariantFamilyCounts: Record<string, number>;
	/** Counts of each endpoint wire-protocol kind that WON a call (§5.AB) — the mode is the model's preferred
	 *  protocol, promoted to the front of the endpoint-iteration ladder next time. */
	endpointKindCounts: Record<string, number>;
	/** F3.15: self-consistency runs folded into this profile (agreement EWMA below; 0 ⇒ never measured). */
	consistencySamples?: number;
	/** F3.15: EWMA of consistency-vote agreement (0..1); LOW = stochastic output. Null until first measured. */
	consistencyAgreementEwma?: number | null;
	/** Largest tool count the model has cleared with a success (its complexity ceiling). */
	complexityCeiling: number | null;
	/** Largest context (tokens) at which quality still cleared the bar. */
	qualityEffectiveContextTokens: number | null;
	/** Smallest context (tokens) at which quality FAILED — the upper bound of the quality knee. */
	qualityDegradedAtTokens: number | null;
	updatedAt: number;
}

export interface ModelBehaviorUpdateOptions {
	/** EWMA smoothing for successRate + avgRetries (0..1; higher = react faster to recent outcomes). Default 0.3. */
	alpha?: number;
	now?: () => number;
}

const DEFAULT_ALPHA = 0.3;

function emptyFailureModes(): Record<ModelOutcomeKind, number> {
	return {
		success: 0,
		no_tool_call: 0,
		narrated: 0,
		loop: 0,
		timeout: 0,
		malformed: 0,
		aborted: 0,
		other_failure: 0,
	};
}

export function emptyModelBehaviorProfile(modelId: string, now = 0): ModelBehaviorProfile {
	return {
		modelId,
		samples: 0,
		successes: 0,
		successRate: 0,
		avgRetries: 0,
		failureModes: emptyFailureModes(),
		toolCallFormatCounts: {},
		promptVariantFamilyCounts: {},
		endpointKindCounts: {},
		complexityCeiling: null,
		qualityEffectiveContextTokens: null,
		qualityDegradedAtTokens: null,
		consistencySamples: 0,
		consistencyAgreementEwma: null,
		updatedAt: now,
	};
}

/**
 * F3.15 — fold one self-consistency run's agreement rate (winner votes / total samples) into the profile.
 * LOW agreement on a model is a stochastic-unreliability signal reliability/routing can consult; recorded
 * observe-first (nothing gates on it yet). Out-of-range inputs are clamped; the EWMA seeds on the first sample.
 */
export function recordConsistencyAgreement(
	profile: ModelBehaviorProfile,
	agreement: number,
	now = 0,
): ModelBehaviorProfile {
	const clamped = Math.max(0, Math.min(1, agreement));
	const isFirst = (profile.consistencySamples ?? 0) === 0;
	return {
		...profile,
		consistencySamples: (profile.consistencySamples ?? 0) + 1,
		consistencyAgreementEwma: ewma(profile.consistencyAgreementEwma ?? 0, clamped, 0.3, isFirst),
		updatedAt: now,
	};
}

function ewma(previous: number, next: number, alpha: number, isFirst: boolean): number {
	return isFirst ? next : previous * (1 - alpha) + next * alpha;
}

function isPositiveInt(value: number | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Fold one attempt outcome into the profile (pure — returns a new profile). Online learning: EWMA the success rate +
 * retries, count the failure mode, and ratchet the complexity ceiling / quality-effective budget. The caller passes a
 * canonical model id (e.g. the MCSR `provider:model:endpoint` key).
 */
export function recordModelBehaviorOutcome(
	profile: ModelBehaviorProfile,
	outcome: ModelAttemptOutcome,
	options: ModelBehaviorUpdateOptions = {},
): ModelBehaviorProfile {
	const alpha = options.alpha ?? DEFAULT_ALPHA;
	const now = options.now?.() ?? profile.updatedAt;
	const isFirst = profile.samples === 0;
	const success = outcome.kind === "success";

	const failureModes = { ...profile.failureModes };
	if (!success) {
		failureModes[outcome.kind] += 1;
	}

	const toolCallFormatCounts = { ...profile.toolCallFormatCounts };
	if (success && outcome.toolCallFormat) {
		toolCallFormatCounts[outcome.toolCallFormat] = (toolCallFormatCounts[outcome.toolCallFormat] ?? 0) + 1;
	}

	// Tolerate legacy persisted profiles from before the field existed (fold-on-read replays them verbatim).
	const promptVariantFamilyCounts = { ...(profile.promptVariantFamilyCounts ?? {}) };
	if (success && outcome.promptVariantFamily) {
		promptVariantFamilyCounts[outcome.promptVariantFamily] =
			(promptVariantFamilyCounts[outcome.promptVariantFamily] ?? 0) + 1;
	}

	// Endpoint wire-protocol winners (§5.AB) — legacy-tolerant like the sibling counts above.
	const endpointKindCounts = { ...(profile.endpointKindCounts ?? {}) };
	if (success && outcome.winningEndpointKind) {
		endpointKindCounts[outcome.winningEndpointKind] = (endpointKindCounts[outcome.winningEndpointKind] ?? 0) + 1;
	}

	// Complexity ceiling: the largest offered tool count the model has SUCCEEDED with.
	let complexityCeiling = profile.complexityCeiling;
	if (success && isPositiveInt(outcome.toolCount)) {
		complexityCeiling = Math.max(complexityCeiling ?? 0, outcome.toolCount);
	}

	// Quality knee (§5.AD): track the largest context that still cleared quality and the smallest that failed it.
	let qualityEffectiveContextTokens = profile.qualityEffectiveContextTokens;
	let qualityDegradedAtTokens = profile.qualityDegradedAtTokens;
	if (isPositiveInt(outcome.contextTokens) && typeof outcome.qualityOk === "boolean") {
		if (outcome.qualityOk) {
			qualityEffectiveContextTokens = Math.max(qualityEffectiveContextTokens ?? 0, outcome.contextTokens);
		} else {
			qualityDegradedAtTokens = Math.min(qualityDegradedAtTokens ?? Number.POSITIVE_INFINITY, outcome.contextTokens);
		}
	}

	const retries = isPositiveInt(outcome.retries) ? outcome.retries : 0;

	return {
		modelId: profile.modelId,
		samples: profile.samples + 1,
		successes: profile.successes + (success ? 1 : 0),
		successRate: ewma(profile.successRate, success ? 1 : 0, alpha, isFirst),
		avgRetries: ewma(profile.avgRetries, retries, alpha, isFirst),
		failureModes,
		toolCallFormatCounts,
		promptVariantFamilyCounts,
		endpointKindCounts,
		complexityCeiling,
		qualityEffectiveContextTokens,
		qualityDegradedAtTokens,
		updatedAt: now,
	};
}

/** The tool-call format the model emits most often on success, or null when none observed yet. */
export function preferredToolCallFormat(profile: ModelBehaviorProfile): string | null {
	let best: string | null = null;
	let bestCount = 0;
	for (const [format, count] of Object.entries(profile.toolCallFormatCounts)) {
		if (count > bestCount) {
			best = format;
			bestCount = count;
		}
	}
	return best;
}

/** The prompt-variant family that has WON the most recoveries for this model, or null when none observed yet. */
export function preferredPromptVariantFamily(profile: ModelBehaviorProfile): string | null {
	let best: string | null = null;
	let bestCount = 0;
	for (const [family, count] of Object.entries(profile.promptVariantFamilyCounts ?? {})) {
		if (count > bestCount) {
			best = family;
			bestCount = count;
		}
	}
	return best;
}

/**
 * The endpoint wire-protocol kind that has WON the most calls for this model (§5.AB), or null when none observed yet /
 * only unrecognized kinds are on record. Narrowed against the canonical ladder so a stale/garbage persisted count can
 * never surface a non-kind — the endpoint-iteration strategy consumes this as its learned `preferredKind`.
 */
export function preferredEndpointKind(profile: ModelBehaviorProfile): LocalModelEndpointKind | null {
	let best: LocalModelEndpointKind | null = null;
	let bestCount = 0;
	for (const [kind, count] of Object.entries(profile.endpointKindCounts ?? {})) {
		if (count > bestCount && (LOCAL_MODEL_ENDPOINT_LADDER as readonly string[]).includes(kind)) {
			best = kind as LocalModelEndpointKind;
			bestCount = count;
		}
	}
	return best;
}

/** The failure mode the model exhibits most often, or null when it has no recorded failures. */
export function dominantFailureMode(profile: ModelBehaviorProfile): ModelOutcomeKind | null {
	let best: ModelOutcomeKind | null = null;
	let bestCount = 0;
	for (const kind of MODEL_FAILURE_KINDS) {
		const count = profile.failureModes[kind];
		if (count > bestCount) {
			best = kind;
			bestCount = count;
		}
	}
	return best;
}

export interface RetryBudgetOptions {
	/** Floor on the budget so even a reliable model gets one retry for a transient blip. Default 1. */
	minBudget?: number;
	/** Ceiling so a hopeless model can't burn unbounded retries. Default 6. */
	maxBudget?: number;
}

/**
 * The learned retry budget (§5.AA): how many retries to allow before declaring a *real* failure. Built from the
 * observed retries-to-outcome plus a reliability margin — a flaky model (low success rate) earns more retries to ride
 * out its stochasticity, a reliable one fewer. Cold start (no samples) returns the min budget. Clamped to [min, max].
 */
export function learnedRetryBudget(profile: ModelBehaviorProfile, options: RetryBudgetOptions = {}): number {
	const minBudget = options.minBudget ?? 1;
	const maxBudget = options.maxBudget ?? 6;
	if (profile.samples === 0) {
		return minBudget;
	}
	// Base on the typical retries it has needed, plus up to `maxBudget` extra scaled by unreliability.
	const reliabilityMargin = (1 - clamp01(profile.successRate)) * maxBudget;
	const budget = Math.ceil(profile.avgRetries + reliabilityMargin);
	return Math.max(minBudget, Math.min(maxBudget, budget));
}

/**
 * The learned quality-effective context budget (§5.AD): the token budget to TARGET for this model — at or below where
 * its output quality starts to degrade, never below the ≥32k floor (invariant #3). When a degradation point is known,
 * target just below it; else fall back to the best-observed good context (or null = unknown, use the model's window).
 */
export function learnedQualityEffectiveBudget(
	profile: ModelBehaviorProfile,
	options: { floorTokens?: number } = {},
): number | null {
	const floor = options.floorTokens ?? 32_000;
	const degraded = profile.qualityDegradedAtTokens;
	const good = profile.qualityEffectiveContextTokens;
	if (degraded !== null) {
		// Target a margin below the first observed degradation, floored at the ≥32k invariant. Do NOT raise the target by
		// the best-observed `good` size: the good/degraded scalars ratchet INDEPENDENTLY and can cross (a good sample at
		// 100k then a degraded one at 60k — stochastic quality, or a good sample from before a config change), and
		// including `good` in the max would then aim the model at a context ABOVE where it has failed quality.
		const target = Math.floor(degraded * 0.9);
		return Math.max(floor, target);
	}
	if (good !== null) {
		return Math.max(floor, good);
	}
	return null;
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}
