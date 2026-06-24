import { buildKanbanContextSafetyBudgets, countKanbanTextTokens } from "./nklein-context-budgets";
import { assertNKleinContextWindowPolicy } from "./nklein-context-window-policy";
import {
	buildNKleinModelRegistryKey,
	type NKleinModelRegistryEntry,
	type NKleinModelRegistrySnapshot,
} from "./nklein-model-registry";
import type { NKleinTaskRoutingDecision } from "./nklein-task-router";

const DEFAULT_START_GUARD_CONTEXT_WINDOW = 80_000;
const START_GUARD_MIN_WORKING_ROOM_TOKENS = 4_000;
const START_GUARD_BASE_DIFFICULTY = 25;
const START_GUARD_MAX_PROMPT_DIFFICULTY_BONUS = 35;
const DEFAULT_SANDBOX_UNAVAILABLE_START_MESSAGE =
	"Docker is required for !Klein agent isolation, but the sandbox is unavailable.";

export interface NKleinStartGuardLaunchConfig {
	providerId: string;
	modelId?: string | null;
	baseUrl?: string | null;
	contextWindow?: number | null;
}

export interface NKleinStartGuardCandidate<
	TLaunchConfig extends NKleinStartGuardLaunchConfig = NKleinStartGuardLaunchConfig,
> {
	entry: NKleinModelRegistryEntry;
	role: string | null;
	launchConfig: TLaunchConfig;
}

export interface NKleinStartGuardSandboxStatus {
	state: "checking" | "ready" | "blocked";
	message: string | null;
}

export interface NKleinStartGuardSandboxBlock {
	error: string;
	errorCode: "agent_sandbox_unavailable";
}

export function buildNKleinSandboxStartBlock(
	status: NKleinStartGuardSandboxStatus | null | undefined,
): NKleinStartGuardSandboxBlock | null {
	if (!status || status.state === "ready") {
		return null;
	}
	return {
		error: status.message?.trim() || DEFAULT_SANDBOX_UNAVAILABLE_START_MESSAGE,
		errorCode: "agent_sandbox_unavailable",
	};
}

export function estimateNKleinStartPromptTokens(input: {
	prompt: string;
	taskTitle?: string | null;
	images?: readonly unknown[];
}): number {
	const titleTokens = input.taskTitle ? countKanbanTextTokens(input.taskTitle) : 0;
	const promptTokens = countKanbanTextTokens(input.prompt);
	const imageTokens = (input.images?.length ?? 0) * 1_000;
	return titleTokens + promptTokens + imageTokens;
}

export function estimateNKleinStartDifficulty(promptTokens: number): number {
	const promptDifficultyBonus = Math.min(START_GUARD_MAX_PROMPT_DIFFICULTY_BONUS, Math.round(promptTokens / 800));
	return Math.min(100, START_GUARD_BASE_DIFFICULTY + promptDifficultyBonus);
}

export function estimateNKleinStartFitBudgetTokens(promptTokens: number, largestContextWindow: number | null): number {
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
}): NKleinModelRegistryEntry {
	const key = buildNKleinModelRegistryKey({
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
			maxConcurrentRequests: null,
		},
		createdAt: input.now,
		updatedAt: input.now,
	};
}

export function buildNKleinStartGuardCandidate<TLaunchConfig extends NKleinStartGuardLaunchConfig>(input: {
	launchConfig: TLaunchConfig;
	role: string | null;
	modelRegistry: NKleinModelRegistrySnapshot;
}): NKleinStartGuardCandidate<TLaunchConfig> {
	const endpoint = input.launchConfig.baseUrl ?? null;
	const modelId = input.launchConfig.modelId ?? "unknown";
	const key = buildNKleinModelRegistryKey({
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
			contextWindow: input.launchConfig.contextWindow ?? null,
			capability: getRoleCapabilityPrior(input.role),
			now: Date.now(),
		});
	const contextWindow = assertNKleinContextWindowPolicy({
		providerId: input.launchConfig.providerId,
		modelId,
		contextWindow: entry.contextWindow.effective ?? input.launchConfig.contextWindow ?? null,
		label: input.role ? `${input.role} role model` : "Selected !Klein model",
	});
	return {
		entry:
			entry.contextWindow.effective === null
				? {
						...entry,
						contextWindow: {
							...entry.contextWindow,
							effective: contextWindow,
						},
					}
				: entry,
		role: input.role,
		launchConfig: input.launchConfig,
	};
}

export function formatNKleinTaskRoutingBlockMessage(
	decision: Extract<NKleinTaskRoutingDecision, { type: "decompose" | "escalate" }>,
): string {
	const action = decision.type === "decompose" ? "needs decomposition" : "needs a stronger/larger model";
	return `Task start blocked: this card ${action}. ${decision.reason}`;
}
