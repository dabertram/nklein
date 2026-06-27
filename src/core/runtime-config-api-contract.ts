import { z } from "zod";
import { AGENT_CAPABILITY_TIERS, AGENT_DELIVERY_TIERS, AGENT_RULESET_ROLES } from "./agent-rulesets.js";

// Runtime + agent CONFIGURATION contract primitives: the core id/column/auto-review enums, NKlein reasoning +
// context-window + timeout + code-embedding settings, swarm guardrail bounds/schema/defaults, per-role model
// settings + the model-roles map, and the agent capability/delivery rulesets. Split out of api-contract.ts
// (§5.X #2 monolith decomposition), re-exported through the `@runtime-contract` barrel so callers are unchanged.
// Imports only `z` + the agent-ruleset tier constants — never the barrel (avoids a zod-const load-order cycle).

export const runtimeAgentIdSchema = z.enum(["claude", "codex", "gemini", "opencode", "droid", "kiro", "nklein"]);
export type RuntimeAgentId = z.infer<typeof runtimeAgentIdSchema>;

const runtimeBoardColumnIdEnum = z.enum(["backlog", "planning", "in_progress", "review", "completed", "trash"]);
export const runtimeBoardColumnIdSchema = z.preprocess(
	(val) => (val === "done" ? "completed" : val),
	runtimeBoardColumnIdEnum,
);
export type RuntimeBoardColumnId = z.infer<typeof runtimeBoardColumnIdEnum>;

const runtimeTaskAutoReviewModeEnum = z.enum(["commit", "pr"]);
export const runtimeTaskAutoReviewModeSchema = z.preprocess(
	(val) => (val === "move_to_trash" || val === "move_to_done" ? "commit" : val),
	runtimeTaskAutoReviewModeEnum,
);
export type RuntimeTaskAutoReviewMode = z.infer<typeof runtimeTaskAutoReviewModeEnum>;

export const runtimeNKleinReasoningEffortSchema = z.enum(["low", "medium", "high", "xhigh"]);
export type RuntimeNKleinReasoningEffort = z.infer<typeof runtimeNKleinReasoningEffortSchema>;
/** Minimum context window (tokens) a model must report before NKlein will activate it. */
export const RUNTIME_NKLEIN_MIN_CONTEXT_WINDOW_TOKENS = 32_000;
/** Assumed context window (tokens) when a model does not report one; used as a conservative fallback in
 *  runtime guards and context-budget calculations. */
export const RUNTIME_NKLEIN_DEFAULT_CONTEXT_WINDOW_TOKENS = 80_000;
export const RUNTIME_SWARM_MAX_CARD_STARTS_PER_BATCH = 12;
export const RUNTIME_NKLEIN_MAX_REPEATED_TOOL_CALLS_PER_TASK = 3;
// Autonomous-run swarm guardrail default limits. These are the *defaults* — the live values come from the
// user-configurable `swarmGuardrails` runtime config (Settings → "Local swarm guardrails"), which falls back to
// these. Both the runtime guardrail logic (nklein-task-session-service) and the Settings editor resolve through
// `DEFAULT_RUNTIME_SWARM_GUARDRAILS`/`normalizeRuntimeSwarmGuardrails` so the two can't drift.
export const RUNTIME_NKLEIN_MAX_AUTONOMOUS_TURNS_PER_TASK = 12;
export const RUNTIME_NKLEIN_MAX_AUTONOMOUS_WALL_TIME_MS = 2 * 60 * 60 * 1000;
export const RUNTIME_NKLEIN_MAX_REPEATED_NO_DIFF_CHECKPOINTS = 4;

export function clampRuntimeSwarmCardStartBatchSize(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return Math.min(RUNTIME_SWARM_MAX_CARD_STARTS_PER_BATCH, Math.trunc(value));
}

// Per-task autonomous-run guardrails the operator can tune (and reset) from Settings. Each is bounded to a sane
// range so a typo can't disable a guardrail or starve a real task. `maxRepeatedToolCallsPerTask` has a hard floor
// of 2 because the guard counts from the *first* call (count starts at 1), so a limit of 1 would park every task
// on its very first tool use.
export const RUNTIME_SWARM_GUARDRAIL_BOUNDS = {
	maxAutonomousTurnsPerTask: { min: 1, max: 1000 },
	maxAutonomousWallTimeMs: { min: 60_000, max: 7 * 24 * 60 * 60 * 1000 },
	maxRepeatedNoDiffCheckpoints: { min: 1, max: 100 },
	maxRepeatedToolCallsPerTask: { min: 2, max: 100 },
} as const;

export const runtimeSwarmGuardrailsSchema = z.object({
	maxAutonomousTurnsPerTask: z.number().int().positive(),
	maxAutonomousWallTimeMs: z.number().int().positive(),
	maxRepeatedNoDiffCheckpoints: z.number().int().positive(),
	maxRepeatedToolCallsPerTask: z.number().int().positive(),
});
export type RuntimeSwarmGuardrails = z.infer<typeof runtimeSwarmGuardrailsSchema>;

export const DEFAULT_RUNTIME_SWARM_GUARDRAILS: RuntimeSwarmGuardrails = {
	maxAutonomousTurnsPerTask: RUNTIME_NKLEIN_MAX_AUTONOMOUS_TURNS_PER_TASK,
	maxAutonomousWallTimeMs: RUNTIME_NKLEIN_MAX_AUTONOMOUS_WALL_TIME_MS,
	maxRepeatedNoDiffCheckpoints: RUNTIME_NKLEIN_MAX_REPEATED_NO_DIFF_CHECKPOINTS,
	maxRepeatedToolCallsPerTask: RUNTIME_NKLEIN_MAX_REPEATED_TOOL_CALLS_PER_TASK,
};

// §5.AI "background eval" guardrail profile: lenient on the SLOW-PROGRESS guards (turns / wall-time / no-diff
// checkpoints) so a slow-but-progressing small local model on the always-on dev-test rail isn't parked prematurely —
// while keeping the LOOP guard (`maxRepeatedToolCallsPerTask`) near-default so a genuinely stuck/looping agent still
// parks. All values stay inside RUNTIME_SWARM_GUARDRAIL_BOUNDS (a profile can't disable a guardrail). NOT the
// interactive default — apply it only for background evaluation runs (the rail saves it, then restores the original).
export const BACKGROUND_EVAL_RUNTIME_SWARM_GUARDRAILS: RuntimeSwarmGuardrails = {
	maxAutonomousTurnsPerTask: 80,
	maxAutonomousWallTimeMs: 6 * 60 * 60 * 1000,
	maxRepeatedNoDiffCheckpoints: 20,
	maxRepeatedToolCallsPerTask: 6,
};

function clampGuardrailInteger(value: unknown, bounds: { min: number; max: number }, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	const truncated = Math.trunc(value);
	if (truncated < bounds.min) {
		return bounds.min;
	}
	if (truncated > bounds.max) {
		return bounds.max;
	}
	return truncated;
}

export function normalizeRuntimeSwarmGuardrails(
	input: Partial<RuntimeSwarmGuardrails> | null | undefined,
): RuntimeSwarmGuardrails {
	return {
		maxAutonomousTurnsPerTask: clampGuardrailInteger(
			input?.maxAutonomousTurnsPerTask,
			RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxAutonomousTurnsPerTask,
			DEFAULT_RUNTIME_SWARM_GUARDRAILS.maxAutonomousTurnsPerTask,
		),
		maxAutonomousWallTimeMs: clampGuardrailInteger(
			input?.maxAutonomousWallTimeMs,
			RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxAutonomousWallTimeMs,
			DEFAULT_RUNTIME_SWARM_GUARDRAILS.maxAutonomousWallTimeMs,
		),
		maxRepeatedNoDiffCheckpoints: clampGuardrailInteger(
			input?.maxRepeatedNoDiffCheckpoints,
			RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxRepeatedNoDiffCheckpoints,
			DEFAULT_RUNTIME_SWARM_GUARDRAILS.maxRepeatedNoDiffCheckpoints,
		),
		maxRepeatedToolCallsPerTask: clampGuardrailInteger(
			input?.maxRepeatedToolCallsPerTask,
			RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxRepeatedToolCallsPerTask,
			DEFAULT_RUNTIME_SWARM_GUARDRAILS.maxRepeatedToolCallsPerTask,
		),
	};
}

export function areRuntimeSwarmGuardrailsEqual(a: RuntimeSwarmGuardrails, b: RuntimeSwarmGuardrails): boolean {
	return (
		a.maxAutonomousTurnsPerTask === b.maxAutonomousTurnsPerTask &&
		a.maxAutonomousWallTimeMs === b.maxAutonomousWallTimeMs &&
		a.maxRepeatedNoDiffCheckpoints === b.maxRepeatedNoDiffCheckpoints &&
		a.maxRepeatedToolCallsPerTask === b.maxRepeatedToolCallsPerTask
	);
}

export const runtimeAgentTimeoutModeSchema = z.preprocess(
	(value) => (value === "very_long" ? "extended" : value),
	z.enum(["normal", "long", "extended", "unlimited"]),
);
export type RuntimeAgentTimeoutMode = z.infer<typeof runtimeAgentTimeoutModeSchema>;
export const runtimeAgentTimeoutProfileSchema = z.enum(["cloud", "local", "custom"]);
export type RuntimeAgentTimeoutProfile = z.infer<typeof runtimeAgentTimeoutProfileSchema>;
export const runtimeLostHeartbeatPolicySchema = z.enum(["park", "keep_running"]);
export type RuntimeLostHeartbeatPolicy = z.infer<typeof runtimeLostHeartbeatPolicySchema>;
export const runtimeCodeEmbeddingProviderSchema = z.enum(["local_lexical", "openai_compatible", "local_gguf"]);
export type RuntimeCodeEmbeddingProvider = z.infer<typeof runtimeCodeEmbeddingProviderSchema>;
export const runtimeCodeEmbeddingSettingsSchema = z.object({
	provider: runtimeCodeEmbeddingProviderSchema,
	model: z.string().nullable(),
	baseUrl: z.string().nullable(),
});
export type RuntimeCodeEmbeddingSettings = z.infer<typeof runtimeCodeEmbeddingSettingsSchema>;
export const runtimeTaskNKleinContextScopeSchema = z.enum(["full", "smart", "minimal", "custom"]);
export type RuntimeTaskNKleinContextScope = z.infer<typeof runtimeTaskNKleinContextScopeSchema>;
export const runtimeTaskNKleinTimeoutModeSchema = z.preprocess(
	(value) => (value === "very_long" ? "extended" : value),
	z.enum(["normal", "long", "extended", "unlimited"]),
);
export type RuntimeTaskNKleinTimeoutMode = z.infer<typeof runtimeTaskNKleinTimeoutModeSchema>;
export const runtimeTimeoutMsSchema = z.number().int().nonnegative().nullable();
export const runtimeTaskNKleinSettingsSchema = z.object({
	providerId: z.string().optional(),
	modelId: z.string().optional(),
	reasoningEffort: runtimeNKleinReasoningEffortSchema.optional(),
	contextScope: runtimeTaskNKleinContextScopeSchema.optional(),
	timeoutMode: runtimeTaskNKleinTimeoutModeSchema.optional(),
	requestTimeoutMs: runtimeTimeoutMsSchema.optional(),
	streamTimeoutMs: runtimeTimeoutMsSchema.optional(),
	toolTimeoutMs: runtimeTimeoutMsSchema.optional(),
	agentTimeoutMs: runtimeTimeoutMsSchema.optional(),
	conversationTimeoutMs: runtimeTimeoutMsSchema.optional(),
});
export type RuntimeTaskNKleinSettings = z.infer<typeof runtimeTaskNKleinSettingsSchema>;
// A role's model config = its primary model settings plus an optional pool of `additionalModels`. When the pool
// is non-empty the role can run on more than one model; task-start fans out across the free, capability-feasible
// members (see #4). Empty/absent `additionalModels` = the historical single-model-per-role behavior, unchanged.
export const runtimeRoleModelSettingsSchema = runtimeTaskNKleinSettingsSchema.extend({
	additionalModels: z.array(runtimeTaskNKleinSettingsSchema).optional(),
});
export type RuntimeRoleModelSettings = z.infer<typeof runtimeRoleModelSettingsSchema>;
export const runtimeModelRolesSchema = z.record(z.string().min(1), runtimeRoleModelSettingsSchema);
export type RuntimeModelRoles = z.infer<typeof runtimeModelRolesSchema>;

// Per-role agent rulesets — two independent tiered dials (capability + delivery autonomy). Tier enums are
// derived from the pure core (src/core/agent-rulesets.ts) so the list lives in one place. `roleOverrides` keys
// are plain strings (the core resolver applies only known roles and ignores the rest), which sidesteps zod's
// exhaustive-enum-record requirement and stays forward-compatible if roles expand.
export const agentCapabilityTierSchema = z.enum(AGENT_CAPABILITY_TIERS);
export const agentDeliveryTierSchema = z.enum(AGENT_DELIVERY_TIERS);
export const agentRulesetRoleSchema = z.enum(AGENT_RULESET_ROLES);
export const agentCapabilityRulesetConfigSchema = z.object({
	globalPreset: agentCapabilityTierSchema,
	roleOverrides: z.record(z.string().min(1), agentCapabilityTierSchema).optional(),
});
export const agentDeliveryRulesetConfigSchema = z.object({
	globalPreset: agentDeliveryTierSchema,
	roleOverrides: z.record(z.string().min(1), agentDeliveryTierSchema).optional(),
});
export const agentRulesetsConfigSchema = z.object({
	capability: agentCapabilityRulesetConfigSchema,
	delivery: agentDeliveryRulesetConfigSchema,
});
export type AgentRulesetsConfigPayload = z.infer<typeof agentRulesetsConfigSchema>;
