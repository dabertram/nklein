import { buildKanbanContextSafetyBudgets, countKanbanTextTokens } from "./cline-context-budgets";
import {
	buildClineModelRegistryKey,
	type ClineModelRegistryEntry,
	type ClineModelRegistrySnapshot,
} from "./cline-model-registry";
import type { ClineTaskRoutingDecision } from "./cline-task-router";

const DEFAULT_START_GUARD_CONTEXT_WINDOW = 80_000;
const START_GUARD_MIN_WORKING_ROOM_TOKENS = 4_000;
const START_GUARD_BASE_DIFFICULTY = 25;
const START_GUARD_MAX_PROMPT_DIFFICULTY_BONUS = 35;

export interface ClineStartGuardLaunchConfig {
	providerId: string;
	modelId?: string | null;
	baseUrl?: string | null;
	contextWindow?: number | null;
}

export interface ClineStartGuardCandidate<
	TLaunchConfig extends ClineStartGuardLaunchConfig = ClineStartGuardLaunchConfig,
> {
	entry: ClineModelRegistryEntry;
	role: string | null;
	launchConfig: TLaunchConfig;
}

export function estimateClineStartPromptTokens(input: {
	prompt: string;
	taskTitle?: string | null;
	images?: readonly unknown[];
}): number {
	const titleTokens = input.taskTitle ? countKanbanTextTokens(input.taskTitle) : 0;
	const promptTokens = countKanbanTextTokens(input.prompt);
	const imageTokens = (input.images?.length ?? 0) * 1_000;
	return titleTokens + promptTokens + imageTokens;
}

export function estimateClineStartDifficulty(promptTokens: number): number {
	const promptDifficultyBonus = Math.min(START_GUARD_MAX_PROMPT_DIFFICULTY_BONUS, Math.round(promptTokens / 800));
	return Math.min(100, START_GUARD_BASE_DIFFICULTY + promptDifficultyBonus);
}

export function estimateClineStartFitBudgetTokens(promptTokens: number, largestContextWindow: number | null): number {
	const budgets = buildKanbanContextSafetyBudgets(largestContextWindow ?? DEFAULT_START_GUARD_CONTEXT_WINDOW);
	return (
		promptTokens +
		budgets.outputReserveTokens +
		budgets.promptOverheadReserveTokens +
		START_GUARD_MIN_WORKING_ROOM_TOKENS
	);
}

function getRoleCapabilityPrior(role: string | null): number {
	if (role === "architect") {
		return 85;
	}
	if (role === "reviewer") {
		return 70;
	}
	if (role === "worker") {
		return 45;
	}
	return 40;
}

function createFallbackRegistryEntry(input: {
	providerId: string;
	modelId: string;
	endpoint: string | null;
	contextWindow: number | null;
	capability: number;
	now: number;
}): ClineModelRegistryEntry {
	const key = buildClineModelRegistryKey({
		providerId: input.providerId,
		modelId: input.modelId,
		endpoint: input.endpoint,
	});
	return {
		key,
		providerId: input.providerId,
		modelId: input.modelId,
		endpoint: input.endpoint,
		contextWindow: {
			advertised: input.contextWindow,
			observed: null,
			userOverride: null,
			effective: input.contextWindow,
		},
		speed: {
			samples: 0,
			promptTokensEwma: null,
			outputTokensEwma: null,
			totalTokensEwma: null,
			prefillTokensPerSecondEwma: null,
			decodeTokensPerSecondEwma: null,
			ttftMsEwma: null,
			wallTimeMsEwma: null,
			wallTimeMsPer1kPromptTokensEwma: null,
			lastPromptTokens: null,
			lastOutputTokens: null,
			lastWallTimeMs: null,
			lastObservedAt: null,
		},
		capability: {
			samples: 0,
			staticPrior: input.capability,
			evalScore: null,
			externalScore: null,
			observedPassRate: null,
			effectiveScore: input.capability,
			lastObservedAt: null,
		},
		constraints: {
			sharedEndpointId: input.endpoint ?? `${input.providerId}:default`,
			inputCostPerMillionTokens: null,
			outputCostPerMillionTokens: null,
		},
		createdAt: input.now,
		updatedAt: input.now,
	};
}

export function buildClineStartGuardCandidate<TLaunchConfig extends ClineStartGuardLaunchConfig>(input: {
	launchConfig: TLaunchConfig;
	role: string | null;
	modelRegistry: ClineModelRegistrySnapshot;
}): ClineStartGuardCandidate<TLaunchConfig> {
	const endpoint = input.launchConfig.baseUrl ?? null;
	const modelId = input.launchConfig.modelId ?? "unknown";
	const key = buildClineModelRegistryKey({
		providerId: input.launchConfig.providerId,
		modelId,
		endpoint,
	});
	const entry =
		input.modelRegistry.models[key] ??
		createFallbackRegistryEntry({
			providerId: input.launchConfig.providerId,
			modelId,
			endpoint,
			contextWindow: input.launchConfig.contextWindow ?? DEFAULT_START_GUARD_CONTEXT_WINDOW,
			capability: getRoleCapabilityPrior(input.role),
			now: Date.now(),
		});
	const contextWindowFallback = input.launchConfig.contextWindow ?? DEFAULT_START_GUARD_CONTEXT_WINDOW;
	return {
		entry:
			entry.contextWindow.effective === null
				? {
						...entry,
						contextWindow: {
							...entry.contextWindow,
							effective: contextWindowFallback,
						},
					}
				: entry,
		role: input.role,
		launchConfig: input.launchConfig,
	};
}

export function formatClineTaskRoutingBlockMessage(
	decision: Extract<ClineTaskRoutingDecision, { type: "decompose" | "escalate" }>,
): string {
	const action = decision.type === "decompose" ? "needs decomposition" : "needs a stronger/larger model";
	return `Task start blocked: this card ${action}. ${decision.reason}`;
}
