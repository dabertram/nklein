import { buildKanbanContextSafetyBudgets } from "./nklein-context-budgets";
import { isLocalProvider } from "./nklein-local-only-policy";
import type { NKleinModelRegistryEntry } from "./nklein-model-registry";

export interface NKleinTaskRoutingCandidate {
	entry: NKleinModelRegistryEntry;
	role?: string | null;
	costRank?: number | null;
	/**
	 * §5.AF live consumption: the registry capability blended with this model's LEDGER-observed success rate (see
	 * `blendCapabilityWithLedgerEvidence`). When supplied, it REPLACES the registry `effectiveScore` for both
	 * feasibility (`capability >= difficulty`) and ranking, so routing follows real-run evidence. Null / undefined
	 * (no evidence) ⇒ the registry score is used unchanged — today's behavior.
	 */
	observedCapability?: number | null;
	/**
	 * §5.AB/§5.AE best-fit signal: opaque strength tags for this model (e.g. `"code"`, `"reasoning"`), derived by the
	 * caller from the model card / §5.AL catalog kind. The router treats them as plain strings (it stays decoupled from
	 * any kind enum): among FEASIBLE candidates it prefers those whose tags overlap the request's `taskAffinityTags`
	 * BEFORE applying smallest-sufficient. Empty/absent ⇒ no affinity preference — pure smallest-sufficient as before.
	 */
	affinityTags?: readonly string[];
}

export interface NKleinTaskRoutingRequest {
	difficulty: number;
	fitBudgetTokens: number;
	promptTokens?: number | null;
	outputTokens?: number | null;
	preferredModelKey?: string | null;
	candidates: readonly NKleinTaskRoutingCandidate[];
	/**
	 * Best-fit tags the TASK needs (e.g. a code-editing card → `"code"`; a planning card → `"reasoning"`), derived by
	 * the caller from the card's resolved skills. Among feasible candidates, the router prefers a higher tag-overlap
	 * with this set before smallest-sufficient. Empty/absent ⇒ no preference (smallest-sufficient only) — back-compat.
	 */
	taskAffinityTags?: readonly string[];
}

export type NKleinTaskRoutingDecision =
	| {
			type: "assign";
			modelKey: string;
			role: string | null;
			reason: string;
	  }
	| {
			type: "route_up";
			modelKey: string;
			role: string | null;
			fromModelKey: string;
			reason: string;
	  }
	| {
			type: "decompose";
			reason: string;
			requiredCapability: number;
			requiredContextWindow: number;
	  }
	| {
			type: "escalate";
			reason: string;
			requiredCapability: number;
			requiredContextWindow: number;
	  };

interface ScoredCandidate extends NKleinTaskRoutingCandidate {
	capability: number;
	contextWindow: number;
	requiredContextWindow: number;
	predictedWallTimeMs: number | null;
}

function normalizeScore(value: number): number {
	if (!Number.isFinite(value)) {
		return 100;
	}
	return Math.max(0, Math.min(100, value));
}

function normalizeTokenBudget(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return Math.trunc(value);
}

function getCandidateCapability(candidate: NKleinTaskRoutingCandidate): number {
	if (candidate.observedCapability !== undefined && candidate.observedCapability !== null) {
		return normalizeScore(candidate.observedCapability);
	}
	return normalizeScore(candidate.entry.capability.effectiveScore);
}

function getCandidateContextWindow(candidate: NKleinTaskRoutingCandidate): number {
	return candidate.entry.contextWindow.effective ?? 0;
}

function estimateWallTimeMs(
	candidate: NKleinTaskRoutingCandidate,
	promptTokens: number | null,
	outputTokens: number | null,
): number | null {
	const speed = candidate.entry.speed;
	const prefillMs =
		promptTokens && speed.prefillTokensPerSecondEwma
			? (promptTokens / speed.prefillTokensPerSecondEwma) * 1000
			: null;
	const decodeMs =
		outputTokens && speed.decodeTokensPerSecondEwma ? (outputTokens / speed.decodeTokensPerSecondEwma) * 1000 : null;
	if (prefillMs === null && decodeMs === null) {
		return speed.wallTimeMsEwma;
	}
	return (prefillMs ?? 0) + (decodeMs ?? 0) + (speed.ttftMsEwma ?? 0);
}

function estimateCandidateRequiredContextWindow(
	candidate: NKleinTaskRoutingCandidate,
	promptTokens: number | null,
	fallbackFitBudgetTokens: number,
): number {
	if (promptTokens === null) {
		return fallbackFitBudgetTokens;
	}
	const contextWindow = getCandidateContextWindow(candidate);
	if (contextWindow <= 0) {
		return fallbackFitBudgetTokens;
	}
	const budgets = buildKanbanContextSafetyBudgets(contextWindow);
	return promptTokens + budgets.outputReserveTokens + budgets.promptOverheadReserveTokens;
}

function scoreCandidates(request: NKleinTaskRoutingRequest): ScoredCandidate[] {
	const promptTokens = request.promptTokens && request.promptTokens > 0 ? request.promptTokens : null;
	const outputTokens = request.outputTokens && request.outputTokens > 0 ? request.outputTokens : null;
	const fitBudgetTokens = normalizeTokenBudget(request.fitBudgetTokens);
	return request.candidates
		.filter((candidate) => isLocalProvider(candidate.entry.providerId, candidate.entry.endpoint))
		.map((candidate) => ({
			...candidate,
			capability: getCandidateCapability(candidate),
			contextWindow: getCandidateContextWindow(candidate),
			requiredContextWindow: estimateCandidateRequiredContextWindow(candidate, promptTokens, fitBudgetTokens),
			predictedWallTimeMs: estimateWallTimeMs(candidate, promptTokens, outputTokens),
		}));
}

/** How many of the task's wanted tags this candidate carries (0 when either side has no tags). Higher = better fit. */
function affinityOverlap(candidate: ScoredCandidate, taskAffinityTags: readonly string[]): number {
	if (taskAffinityTags.length === 0 || !candidate.affinityTags || candidate.affinityTags.length === 0) {
		return 0;
	}
	let overlap = 0;
	for (const tag of candidate.affinityTags) {
		if (taskAffinityTags.includes(tag)) {
			overlap += 1;
		}
	}
	return overlap;
}

/**
 * Order feasible candidates: BEST-FIT first (more task-tag overlap), then the existing smallest-sufficient rule. So a
 * code-editing card prefers a `"code"` model over an equally-capable general one, but the affinity only reorders models
 * that ALREADY clear difficulty + the context-window guard — it never makes an incapable model win.
 */
function compareCandidatesWithAffinity(
	left: ScoredCandidate,
	right: ScoredCandidate,
	taskAffinityTags: readonly string[],
): number {
	const overlapDelta = affinityOverlap(right, taskAffinityTags) - affinityOverlap(left, taskAffinityTags);
	if (overlapDelta !== 0) {
		return overlapDelta; // more overlap sorts first
	}
	return compareCandidates(left, right);
}

function compareCandidates(left: ScoredCandidate, right: ScoredCandidate): number {
	const capabilityDelta = left.capability - right.capability;
	if (capabilityDelta !== 0) {
		return capabilityDelta;
	}
	const leftCost = left.costRank ?? Number.POSITIVE_INFINITY;
	const rightCost = right.costRank ?? Number.POSITIVE_INFINITY;
	const costDelta = leftCost - rightCost;
	if (costDelta !== 0) {
		return costDelta;
	}
	const leftWallTime = left.predictedWallTimeMs ?? Number.POSITIVE_INFINITY;
	const rightWallTime = right.predictedWallTimeMs ?? Number.POSITIVE_INFINITY;
	const wallTimeDelta = leftWallTime - rightWallTime;
	if (wallTimeDelta !== 0) {
		return wallTimeDelta;
	}
	return left.entry.key.localeCompare(right.entry.key);
}

export function routeNKleinTask(request: NKleinTaskRoutingRequest): NKleinTaskRoutingDecision {
	const difficulty = normalizeScore(request.difficulty);
	const fitBudgetTokens = normalizeTokenBudget(request.fitBudgetTokens);
	const candidates = scoreCandidates(request);
	const taskAffinityTags = request.taskAffinityTags ?? [];
	const feasible = candidates
		.filter(
			(candidate) =>
				candidate.capability >= difficulty && candidate.contextWindow >= candidate.requiredContextWindow,
		)
		.sort((left, right) => compareCandidatesWithAffinity(left, right, taskAffinityTags));
	const preferredModelKey = request.preferredModelKey ?? null;
	const preferred = preferredModelKey
		? candidates.find((candidate) => candidate.entry.key === preferredModelKey)
		: null;

	if (feasible.length > 0) {
		if (preferred && feasible.some((candidate) => candidate.entry.key === preferred.entry.key)) {
			return {
				type: "assign",
				modelKey: preferred.entry.key,
				role: preferred.role ?? null,
				reason: `Selected feasible preferred model for difficulty ${difficulty}.`,
			};
		}
		const selected = feasible[0];
		if (preferred) {
			return {
				type: "route_up",
				modelKey: selected.entry.key,
				role: selected.role ?? null,
				fromModelKey: preferred.entry.key,
				reason: `Preferred model does not fit the required capability/window; selected the smallest candidate satisfying difficulty ${difficulty} and the candidate-specific context fit guard.`,
			};
		}
		return {
			type: "assign",
			modelKey: selected.entry.key,
			role: selected.role ?? null,
			reason: `Selected smallest sufficient model for difficulty ${difficulty} and fit budget ${fitBudgetTokens.toLocaleString()} tokens.`,
		};
	}

	const hasCapableModel = candidates.some((candidate) => candidate.capability >= difficulty);
	const hasLargeEnoughWindow = candidates.some(
		(candidate) => candidate.contextWindow >= candidate.requiredContextWindow,
	);
	const positiveRequiredContextWindows = candidates
		.map((candidate) => candidate.requiredContextWindow)
		.filter((value) => value > 0);
	const requiredContextWindow =
		positiveRequiredContextWindows.length > 0 ? Math.min(...positiveRequiredContextWindows) : fitBudgetTokens;
	if (hasCapableModel || hasLargeEnoughWindow) {
		return {
			type: "decompose",
			reason: `No connected model satisfies both difficulty ${difficulty} and the candidate-specific context fit guard.`,
			requiredCapability: difficulty,
			requiredContextWindow,
		};
	}

	return {
		type: "escalate",
		reason: `No connected model is capable enough or large enough for difficulty ${difficulty} and the candidate-specific context fit guard.`,
		requiredCapability: difficulty,
		requiredContextWindow,
	};
}
