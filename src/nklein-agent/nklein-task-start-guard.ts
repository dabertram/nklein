import { RUNTIME_NKLEIN_DEFAULT_CONTEXT_WINDOW_TOKENS } from "../core/api-contract";
import { supportsThinkingControl } from "../core/model-thinking-control";
import { buildKanbanContextSafetyBudgets, countKanbanTextTokens } from "./nklein-context-budgets";
import { assertNKleinContextWindowPolicy } from "./nklein-context-window-policy";
import {
	buildNKleinModelRegistryKey,
	type NKleinModelRegistryEntry,
	type NKleinModelRegistrySnapshot,
} from "./nklein-model-registry";
import type { NKleinTaskRoutingDecision } from "./nklein-task-router";

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

/**
 * Cheap CONTENT signals blended into the start-difficulty estimate (audit 2026-07-02 W1.2). The token-count-only
 * estimator mis-routes in both directions — a verbose trivial card over-provisions the scarce strong machine, and a
 * terse hard card ("fix the race in the scheduler") routes to a 4B that fails and burns a route-up cycle. It is also
 * the gate the /no_think decision (W1.3) feeds on, so its weakness compounds. All signals are optional — omitting
 * them reproduces the historical token-only behavior byte-for-byte.
 */
export interface NKleinStartDifficultySignals {
	/** Resolved skill ids for the card (see `resolveActiveSkills`); `planning` raises the floor — plan cards are hard. */
	skillIds?: readonly string[];
	/** The card starts in plan mode (decompose/architect stage) — hard regardless of prompt length. */
	isPlanCard?: boolean;
	/** Title + prompt text for keyword signals (refactor/migration/concurrency = hard; typo/rename/docs = easy). */
	taskText?: string;
}

const HARD_TASK_TEXT =
	/refactor|architect|migrat|concurren|\brace\b|deadlock|protocol|crypto|security|performance|optimi[sz]/i;
const EASY_TASK_TEXT = /typo|rename|\bcomment\b|readme|documentation|\blabel\b|copy change/i;
// A BUMP, deliberately not a hard floor: the router treats difficulty as HARD feasibility (`capability >=
// difficulty`) and auto-offered loaded models carry a conservative prior of 40 — a floor of e.g. 60 would make
// every plan card ESCALATE on a fleet with no configured architect role. The "plan cards demand a capable model"
// hard semantics lands with W2.5 auto-selection, where capability estimates are real instead of priors.
const PLAN_CARD_DIFFICULTY_BONUS = 10;
const HARD_TEXT_DIFFICULTY_BONUS = 12;
const EASY_TEXT_DIFFICULTY_DAMPENER = 10;

export function estimateNKleinStartDifficulty(promptTokens: number, signals?: NKleinStartDifficultySignals): number {
	const promptDifficultyBonus = Math.min(START_GUARD_MAX_PROMPT_DIFFICULTY_BONUS, Math.round(promptTokens / 800));
	let difficulty = START_GUARD_BASE_DIFFICULTY + promptDifficultyBonus;
	const taskText = signals?.taskText ?? "";
	const isHardText = taskText.length > 0 && HARD_TASK_TEXT.test(taskText);
	if (isHardText) {
		difficulty += HARD_TEXT_DIFFICULTY_BONUS;
	} else if (taskText.length > 0 && EASY_TASK_TEXT.test(taskText)) {
		difficulty -= EASY_TEXT_DIFFICULTY_DAMPENER;
	}
	if (signals?.isPlanCard || signals?.skillIds?.includes("planning")) {
		difficulty += PLAN_CARD_DIFFICULTY_BONUS;
	}
	return Math.max(5, Math.min(100, difficulty));
}

/** Cards at or below this difficulty get thinking disabled on switchable models (W1.3 — the reasoning-token tax). */
const SWARM_THINKING_DISABLE_MAX_DIFFICULTY = 30;

/**
 * Should the swarm DISABLE thinking (`/no_think`) for this task on this model? (audit 2026-07-02 W1.3.) Switchable
 * reasoning models burn 500–965 reasoning tokens on trivial cards every turn — wall-time waste that also converts
 * borderline cards into truncation failures. True only when BOTH hold: the model has a live-verified thinking
 * soft-switch (`supportsThinkingControl` — non-switchable families like qwen3.5/r1 rely on the W1.1 budget-raise
 * instead) AND the card's blended difficulty (W1.2) is LOW — hard cards keep their reasoning (it helps there).
 */
export function shouldDisableSwarmThinking(input: {
	modelId: string | null | undefined;
	prompt: string;
	taskTitle?: string | null;
}): boolean {
	if (!input.modelId || !supportsThinkingControl(input.modelId)) {
		return false;
	}
	const promptTokens = estimateNKleinStartPromptTokens({ prompt: input.prompt, taskTitle: input.taskTitle });
	const difficulty = estimateNKleinStartDifficulty(promptTokens, {
		taskText: `${input.taskTitle ?? ""}\n${input.prompt}`,
	});
	return difficulty <= SWARM_THINKING_DISABLE_MAX_DIFFICULTY;
}

export function estimateNKleinStartFitBudgetTokens(promptTokens: number, largestContextWindow: number | null): number {
	const budgets = buildKanbanContextSafetyBudgets(
		largestContextWindow ?? RUNTIME_NKLEIN_DEFAULT_CONTEXT_WINDOW_TOKENS,
	);
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
