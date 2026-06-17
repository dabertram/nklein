import type { ClineModelRegistryEntry } from "./cline-model-registry";

export interface ClineTaskRoutingCandidate {
	entry: ClineModelRegistryEntry;
	role?: string | null;
	costRank?: number | null;
}

export interface ClineTaskRoutingRequest {
	difficulty: number;
	fitBudgetTokens: number;
	promptTokens?: number | null;
	outputTokens?: number | null;
	preferredModelKey?: string | null;
	candidates: readonly ClineTaskRoutingCandidate[];
}

export type ClineTaskRoutingDecision =
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

interface ScoredCandidate extends ClineTaskRoutingCandidate {
	capability: number;
	contextWindow: number;
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

function getCandidateCapability(candidate: ClineTaskRoutingCandidate): number {
	return normalizeScore(candidate.entry.capability.effectiveScore);
}

function getCandidateContextWindow(candidate: ClineTaskRoutingCandidate): number {
	return candidate.entry.contextWindow.effective ?? 0;
}

function estimateWallTimeMs(
	candidate: ClineTaskRoutingCandidate,
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

function scoreCandidates(request: ClineTaskRoutingRequest): ScoredCandidate[] {
	const promptTokens = request.promptTokens && request.promptTokens > 0 ? request.promptTokens : null;
	const outputTokens = request.outputTokens && request.outputTokens > 0 ? request.outputTokens : null;
	return request.candidates.map((candidate) => ({
		...candidate,
		capability: getCandidateCapability(candidate),
		contextWindow: getCandidateContextWindow(candidate),
		predictedWallTimeMs: estimateWallTimeMs(candidate, promptTokens, outputTokens),
	}));
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

export function routeClineTask(request: ClineTaskRoutingRequest): ClineTaskRoutingDecision {
	const difficulty = normalizeScore(request.difficulty);
	const fitBudgetTokens = normalizeTokenBudget(request.fitBudgetTokens);
	const candidates = scoreCandidates(request);
	const feasible = candidates
		.filter((candidate) => candidate.capability >= difficulty && candidate.contextWindow >= fitBudgetTokens)
		.sort(compareCandidates);
	const preferredModelKey = request.preferredModelKey ?? null;
	const preferred = preferredModelKey
		? candidates.find((candidate) => candidate.entry.key === preferredModelKey)
		: null;

	if (feasible.length > 0) {
		const selected = feasible[0];
		if (preferred && preferred.entry.key !== selected.entry.key) {
			return {
				type: "route_up",
				modelKey: selected.entry.key,
				role: selected.role ?? null,
				fromModelKey: preferred.entry.key,
				reason: `Preferred model cannot satisfy difficulty ${difficulty} and fit budget ${fitBudgetTokens.toLocaleString()} tokens.`,
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
	const hasLargeEnoughWindow = candidates.some((candidate) => candidate.contextWindow >= fitBudgetTokens);
	if (hasCapableModel || hasLargeEnoughWindow) {
		return {
			type: "decompose",
			reason: `No connected model satisfies both difficulty ${difficulty} and fit budget ${fitBudgetTokens.toLocaleString()} tokens.`,
			requiredCapability: difficulty,
			requiredContextWindow: fitBudgetTokens,
		};
	}

	return {
		type: "escalate",
		reason: `No connected model is capable enough or large enough for difficulty ${difficulty} and fit budget ${fitBudgetTokens.toLocaleString()} tokens.`,
		requiredCapability: difficulty,
		requiredContextWindow: fitBudgetTokens,
	};
}
