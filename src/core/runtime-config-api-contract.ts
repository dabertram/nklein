import { z } from "zod";
import { AGENT_CAPABILITY_TIERS, AGENT_DELIVERY_TIERS, AGENT_RULESET_ROLES } from "./agent-rulesets.js";

// Runtime + agent CONFIGURATION contract primitives: the core id/column/auto-review enums, NKlein reasoning +
// context-window + timeout + code-embedding settings, swarm guardrail bounds/schema/defaults, per-role model
// settings + the model-roles map, and the agent capability/delivery rulesets. Split out of api-contract.ts
// (§5.X #2 monolith decomposition), re-exported through the `@runtime-contract` barrel so callers are unchanged.
// Imports only `z` + the agent-ruleset tier constants — never the barrel (avoids a zod-const load-order cycle).

// P0.9c: nklein is the ONLY agent id. API/request surfaces stay STRICT (an invalid id is a 400, never silently
// accepted), while PERSISTED state written by pre-lockdown builds may still carry terminal-CLI agent ids
// ("claude", "codex", ...) — the migration variant below catches any unknown value to "nklein" instead of failing
// the load; it is the upgrade path for board.json / sessions.json reads.
export const runtimeAgentIdSchema = z.enum(["nklein"]);
export const runtimeAgentIdWithLegacyMigrationSchema = runtimeAgentIdSchema.catch("nklein");
export type RuntimeAgentId = z.infer<typeof runtimeAgentIdSchema>;

const runtimeBoardColumnIdEnum = z.enum([
	"backlog",
	"planning",
	"ready",
	"in_progress",
	"review",
	"completed",
	"trash",
]);
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

// F5.2 Basic Memory freshness/consistency audit controls (operator-tunable from Settings, reset-able). The audit is
// read-only (flags stale/orphaned/broken-link/duplicate notes — never deletes), so it's safe ON by default; the
// cadence gates it so the idle rail never churns. Bounds keep a typo from setting a churny cadence or a nonsense window.
const MS_PER_DAY_CONFIG = 24 * 60 * 60 * 1000;
export const RUNTIME_MEMORY_FRESHNESS_AUDIT_BOUNDS = {
	cadenceMs: { min: MS_PER_DAY_CONFIG, max: 90 * MS_PER_DAY_CONFIG },
	stalenessThresholdMs: { min: 7 * MS_PER_DAY_CONFIG, max: 365 * MS_PER_DAY_CONFIG },
} as const;

export const runtimeMemoryFreshnessAuditSchema = z.object({
	enabled: z.boolean(),
	/** When true, the audit is temporarily suspended without losing the enabled setting (the F5.2 pause control). */
	paused: z.boolean(),
	cadenceMs: z.number().int().positive(),
	stalenessThresholdMs: z.number().int().positive(),
});
export type RuntimeMemoryFreshnessAudit = z.infer<typeof runtimeMemoryFreshnessAuditSchema>;

export const DEFAULT_RUNTIME_MEMORY_FRESHNESS_AUDIT: RuntimeMemoryFreshnessAudit = {
	enabled: true,
	paused: false,
	cadenceMs: 7 * MS_PER_DAY_CONFIG, // weekly — never churny
	stalenessThresholdMs: 90 * MS_PER_DAY_CONFIG, // a note untouched for a quarter is worth a look
};

/** Clamp + fill a partial/untrusted memory-audit config to the bounded, fully-populated shape (never drifts). */
export function normalizeRuntimeMemoryFreshnessAudit(value: unknown): RuntimeMemoryFreshnessAudit {
	const parsed =
		value && typeof value === "object" ? (value as Partial<Record<keyof RuntimeMemoryFreshnessAudit, unknown>>) : {};
	const clamp = (raw: unknown, bounds: { min: number; max: number }, fallback: number): number => {
		const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : fallback;
		return Math.min(bounds.max, Math.max(bounds.min, n));
	};
	return {
		enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_RUNTIME_MEMORY_FRESHNESS_AUDIT.enabled,
		paused: typeof parsed.paused === "boolean" ? parsed.paused : DEFAULT_RUNTIME_MEMORY_FRESHNESS_AUDIT.paused,
		cadenceMs: clamp(
			parsed.cadenceMs,
			RUNTIME_MEMORY_FRESHNESS_AUDIT_BOUNDS.cadenceMs,
			DEFAULT_RUNTIME_MEMORY_FRESHNESS_AUDIT.cadenceMs,
		),
		stalenessThresholdMs: clamp(
			parsed.stalenessThresholdMs,
			RUNTIME_MEMORY_FRESHNESS_AUDIT_BOUNDS.stalenessThresholdMs,
			DEFAULT_RUNTIME_MEMORY_FRESHNESS_AUDIT.stalenessThresholdMs,
		),
	};
}

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

// §5.AB parallel-swarm guardrail profile (near-term user steer 2026-06-29): when several models run as a swarm on
// the serialized local endpoints, each role's model queues behind the others, so per-task wall-time is much longer —
// and the user has explicitly ACCEPTED long waits ("the reference bar is a comparably very slow human developer;
// if quality pays for it, long waits are fine — !Klein runs unattended"). So this profile is lenient on the
// SLOW-PROGRESS guards (turns / wall-time / no-diff) — generously, since the bottleneck is queueing not looping —
// while keeping the LOOP guard (`maxRepeatedToolCallsPerTask`) protective so a genuinely stuck/looping agent still
// parks. All values stay inside RUNTIME_SWARM_GUARDRAIL_BOUNDS. NOT the interactive single-model default — apply it
// only when running the multi-model swarm (the per-role wiring leaf, below), never silently to single-model use.
export const PARALLEL_SWARM_RUNTIME_SWARM_GUARDRAILS: RuntimeSwarmGuardrails = {
	maxAutonomousTurnsPerTask: 48,
	maxAutonomousWallTimeMs: 8 * 60 * 60 * 1000,
	maxRepeatedNoDiffCheckpoints: 8,
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

export function areRuntimeMemoryFreshnessAuditEqual(
	a: RuntimeMemoryFreshnessAudit,
	b: RuntimeMemoryFreshnessAudit,
): boolean {
	return (
		a.enabled === b.enabled &&
		a.paused === b.paused &&
		a.cadenceMs === b.cadenceMs &&
		a.stalenessThresholdMs === b.stalenessThresholdMs
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
export const runtimeSandboxIsolationProfileSchema = z.enum(["lean_shared", "strict_per_agent", "custom"]);
export type RuntimeSandboxIsolationProfile = z.infer<typeof runtimeSandboxIsolationProfileSchema>;
export const DEFAULT_RUNTIME_SANDBOX_ISOLATION_PROFILE: RuntimeSandboxIsolationProfile = "lean_shared";
export const runtimeCodeEmbeddingProviderSchema = z.enum(["local_lexical", "openai_compatible", "local_gguf"]);
export type RuntimeCodeEmbeddingProvider = z.infer<typeof runtimeCodeEmbeddingProviderSchema>;
export const runtimeCodeEmbeddingSettingsSchema = z.object({
	provider: runtimeCodeEmbeddingProviderSchema,
	model: z.string().nullable(),
	baseUrl: z.string().nullable(),
});
export type RuntimeCodeEmbeddingSettings = z.infer<typeof runtimeCodeEmbeddingSettingsSchema>;
// §5.AL model-capability gate policy: the action for a not-suitable / unknown model. `allow` = use it, `warn` = use
// with a caveat, `reject` = refuse. Global default + per-project override (the §5.W pattern), mirroring codeEmbedding.
export const runtimeModelGateActionSchema = z.enum(["allow", "warn", "reject"]);
export type RuntimeModelGateAction = z.infer<typeof runtimeModelGateActionSchema>;
export const runtimeModelSuitabilityPolicySchema = z.object({
	onUnsuitable: runtimeModelGateActionSchema,
	onUnknown: runtimeModelGateActionSchema,
});
export type RuntimeModelSuitabilityPolicy = z.infer<typeof runtimeModelSuitabilityPolicySchema>;
export const DEFAULT_RUNTIME_MODEL_SUITABILITY_POLICY: RuntimeModelSuitabilityPolicy = {
	onUnsuitable: "reject",
	onUnknown: "warn",
};
// §5.AE skill-dynamics level: how dynamic vs. strict the per-task skill assignment is (the role-mode control surface).
// Global default + per-project override (the §5.W pattern). Mirrors the §5.AE `SkillDynamicsLevel` resolver type.
export const runtimeSkillDynamicsLevelSchema = z.enum([
	"fully_dynamic",
	"static_skills_auto_model",
	"assigned_skills",
	"fully_static",
]);
export type RuntimeSkillDynamicsLevel = z.infer<typeof runtimeSkillDynamicsLevelSchema>;
export const DEFAULT_RUNTIME_SKILL_DYNAMICS_LEVEL: RuntimeSkillDynamicsLevel = "fully_dynamic";
// §5.AK file-overlap parallelization: may the auto-start loop start a task whose likely-touched files overlap an
// active task? "serialize" = defer until the active task completes (today's behavior); "allow" = start it in
// parallel (backed by the Phase B merge agent). Global default + per-project override (the §5.W pattern).
export const runtimeFileOverlapParallelismSchema = z.enum(["serialize", "allow"]);
export type RuntimeFileOverlapParallelism = z.infer<typeof runtimeFileOverlapParallelismSchema>;
// §5.AB llmfit catalog update policy. The runtime never performs surprise background egress here: `notify` checks and
// suggests on explicit user action, `auto` may pull on explicit user action / future opt-in schedule, and `off` skips.
export const runtimeLlmfitCatalogUpdateModeSchema = z.enum(["off", "notify", "auto"]);
export type RuntimeLlmfitCatalogUpdateMode = z.infer<typeof runtimeLlmfitCatalogUpdateModeSchema>;
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
// §5.AE per-role model-class cap (compute control): the strongest model class a role may use. `small_only` = only
// small local models; `any_local` = any local model (cloud excluded); `any` = no cap (cloud stays #1-locked regardless).
// Absent ⇒ uncapped (today's behavior). Drives a deterministic candidate filter at task-start.
export const runtimeModelClassCapSchema = z.enum(["small_only", "any_local", "any"]);
export type RuntimeModelClassCap = z.infer<typeof runtimeModelClassCapSchema>;
/** §5.I#4 speed-vs-capability dial: bias this role's auto-selection toward the fastest fit vs the most capable. */
export const runtimeSpeedVsCapabilitySchema = z.enum(["capability", "balanced", "speed"]);
export type RuntimeSpeedVsCapability = z.infer<typeof runtimeSpeedVsCapabilitySchema>;
/** Auto is the default. Pinned means the role's concrete primary model id is a hard user pin when loaded/class-eligible/feasible. */
export const runtimeModelSelectionModeSchema = z.enum(["auto", "pinned"]);
export type RuntimeModelSelectionMode = z.infer<typeof runtimeModelSelectionModeSchema>;
export const runtimeRoleModelSettingsSchema = runtimeTaskNKleinSettingsSchema.extend({
	additionalModels: z.array(runtimeTaskNKleinSettingsSchema).optional(),
	modelClassCap: runtimeModelClassCapSchema.optional(),
	/** Omitted ⇒ "capability" (today's behavior: most-capable-first; speed only as an implicit tiebreak). */
	speedVsCapability: runtimeSpeedVsCapabilitySchema.optional(),
	/** Omitted ⇒ "auto": role model(s) participate in auto-selection but do not override it. */
	modelSelectionMode: runtimeModelSelectionModeSchema.optional(),
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
