/**
 * The Agent Attempt Ledger (todo §5.AF) — the keystone evidence substrate.
 *
 * Every new ambition (§5.AA model-behaviour learning, §5.AB fitness/selection, §5.AC retrieval, §5.AD context quality,
 * §5.Z cross-model matrix, retry budgets, loop salvage, replay debugging, the durable scheduler, operator UX) consumes
 * or produces the SAME thing — a per-attempt outcome record — but today those outcomes evaporate into per-domain stores
 * (`task-run-summary-store`, model-registry observations, knowledge-tool telemetry) that share no grain or key. This is
 * the ONE durable evidence stream; the rest become projections of it.
 *
 * Per the 2026-06-27 small-LLM research refinement (background in todo.md §5.AF), the ledger
 * is a **workflow event log + attempt evidence stream**, not just a per-model-attempt table: a model attempt is one
 * event family alongside controller transitions and scheduler/lease events, because small models need the harness to own
 * long-horizon state (resume + explain exactly, instead of re-asking a weak model to rediscover it).
 *
 * This module is the PURE core: a discriminated-union event schema (extensible — adding a field/event-kind is local),
 * pure builders that fill defaults, and the projection queries the consumers read. The persisted append-only store
 * (`src/state/agent-attempt-ledger-store.ts`) is a thin `jsonl-store` wrapper over this schema. Pure-core-first, mirroring
 * `model-behavior-profile` / `model-fitness` / `concurrency-config`, so the substrate lands testable before its consumers.
 *
 * Invariants: host-side control-plane (it RECORDS agent attempts; it never runs on the agent's behalf), append-only,
 * local-only (#1). It never holds secrets or host-absolute paths — callers pass a workspace-path HASH, not the path.
 */

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { selectAttempts } from "./agent-ledger-selectors";
import type { ModelOutcomeKind } from "./model-behavior-profile";
import { meanOrNull, medianOrNull } from "./number-stats";
import { RETRY_STRATEGIES, type RetryStrategy } from "./retry-policy";

// Re-export the pure ledger selectors (now in agent-ledger-selectors) so existing importers of this module
// (agent-ledger-projections, agent-attempt-ledger-store, commands/dev) are unchanged.
export * from "./agent-ledger-selectors";

/** The classified model outcomes, as a zod enum kept in lock-step with `ModelOutcomeKind` (the typed-const guard below). */
const modelOutcomeKindSchema = z.enum([
	"success",
	"no_tool_call",
	"narrated",
	"loop",
	"timeout",
	"malformed",
	"aborted",
	"other_failure",
]);
// Compile-time drift guard: if `ModelOutcomeKind` (§5.AA) changes, this assignment fails until the enum is updated.
const _outcomeKindGuard: z.ZodType<ModelOutcomeKind> = modelOutcomeKindSchema;
void _outcomeKindGuard;
const retryStrategySchema = z.enum(RETRY_STRATEGIES);
const _retryStrategyGuard: z.ZodType<RetryStrategy> = retryStrategySchema;
void _retryStrategyGuard;

/** The lifecycle/lease event families the durable scheduler (§5.AF) records (extensible). */
export const SCHEDULER_EVENT_NAMES = [
	"queued",
	"dequeued",
	"lease_acquired",
	"heartbeat",
	"lease_expired",
	"reclaimed",
	"retry_backoff",
	"cancelled",
	"dependency_unblocked",
	/** A leased job's worker reported a terminal outcome (succeeded/failed in `detail`) — the lease concluded. */
	"completed",
	/** A dependency_failed-cancelled job whose failed dependency later DELIVERED — back to ready (F1.18b live-found). */
	"resurrected",
] as const;
const schedulerEventNameSchema = z.enum(SCHEDULER_EVENT_NAMES);
export type SchedulerEventName = z.infer<typeof schedulerEventNameSchema>;

/** One tool call inside an attempt — name + lossless full-input fingerprint (§5.O) + its own outcome. */
const attemptToolCallSchema = z.object({
	name: z.string(),
	fingerprint: z.string().nullable(),
	outcome: z.string().nullable(),
	/** F1.16: durable content hash of what the tool returned (replay evidence); absent on legacy lines. */
	resultHash: z.string().nullable().optional(),
	/**
	 * File paths this call read/wrote (from its input) — the per-step context signal PRM's `context_thrash` detector
	 * needs. Absent on legacy lines and on non-file tools; additive + backward-compatible.
	 */
	filePaths: z.array(z.string()).optional(),
	/** F12.55b: bounded text preview of what the call RETURNED (trail rendering); absent on legacy lines. */
	resultSummary: z.string().nullable().optional(),
	/**
	 * P21.13c (container-use; docs/attributions.md): the EXECUTED COMMAND LINE for exec-class tools, bounded —
	 * for weak models the failure lives in the HOW, and "what did it actually run?" must be answerable from the
	 * ledger alone. Absent on legacy lines and non-exec tools. Redaction hardens further with P21.13b's
	 * secrets-as-references (values then never enter inputs in the first place).
	 */
	commandLine: z.string().nullable().optional(),
});
export type AttemptToolCall = z.infer<typeof attemptToolCallSchema>;

/** Durable output pointers (host-side refs — for delivery audit + replay). */
const attemptArtifactsSchema = z.object({
	resultBranch: z.string().nullable(),
	patchRef: z.string().nullable(),
	evidenceBundle: z.string().nullable(),
});
export type AttemptArtifacts = z.infer<typeof attemptArtifactsSchema>;

/**
 * The common envelope every ledger event carries. `workflowId` groups all events of one card/run (the durable
 * workflow handle the scheduler owns); `workspacePathHash` keeps the path out of the ledger (no host-path leak, #2).
 */
const ledgerEnvelopeShape = {
	schemaVersion: z.literal(1),
	eventId: z.string(),
	recordedAt: z.number(),
	/** The durable run/workflow handle (groups attempts + transitions + scheduler events for one card/run). */
	workflowId: z.string(),
	taskId: z.string(),
	/** A hash of the workspace path (never the path itself). */
	workspacePathHash: z.string(),
	/** The canonical role string (architect/worker/reviewer/…) when known. */
	role: z.string().nullable(),
} as const;

/**
 * F1.1 — the per-attempt KNOWLEDGE-TOOL usage summary. Distilled from the attempt's `toolCalls` at write time
 * (retrieval = codebase_retrieval/code_index/architecture_knowledge; localization = file_discovery/file_read) so
 * projections can correlate knowledge consultation with delivery outcome without re-classifying transcripts.
 */
const attemptKnowledgeUsageSchema = z.object({
	/** Calls that CONSULT knowledge (code search / repo map / architecture knowledge). */
	retrievalCallCount: z.number().int().nonnegative(),
	/** Calls that LOCALIZE (file discovery + file reads). */
	localizationCallCount: z.number().int().nonnegative(),
	/** Retrieval/localization calls that errored. */
	knowledgeErrorCount: z.number().int().nonnegative(),
	/** Distinct knowledge/localization categories observed, sorted. */
	categoriesUsed: z.array(z.string()),
	/** F1.1 — whether the task's originating plan card declared knowledge debt; null when unknown/not plan-born. */
	knowledgeDebtPresent: z.boolean().nullable().default(null),
});
export type AttemptKnowledgeUsage = z.infer<typeof attemptKnowledgeUsageSchema>;

/** kind="attempt" — one model invocation toward a task/turn (including its retry rung). The richest event family. */
const attemptEventSchema = z.object({
	...ledgerEnvelopeShape,
	kind: z.literal("attempt"),
	attemptId: z.string(),
	parentAttemptId: z.string().nullable(),
	/** Canonical `provider:model:endpoint` identity. */
	modelId: z.string(),
	endpoint: z.string().nullable(),
	/** Which local API surface was used (§5.AA endpoint iteration — the compat vs native local endpoints). */
	endpointStrategy: z.string().nullable(),
	/** Which §5.AA/§5.AE prompt lever was applied this rung. */
	promptStrategy: z.string().nullable(),
	toolSetOffered: z.array(z.string()),
	/** §5.AA tool-set-reduction level (0 = full set). */
	simplificationLevel: z.number(),
	contextTokens: z.number().nullable(),
	// N18: reasoning-only tokens for this attempt, when the server reported them. Additive with a null default so
	// the 226 existing v1 records (which lack it) parse unchanged — no schemaVersion bump. null means "not
	// reported", distinct from 0; the fitness/behaviour rollups that read this must keep them apart.
	reasoningTokens: z.number().nullable().default(null),
	/** §5.AD context budget target in play. */
	contextBudgetTarget: z.number().nullable(),
	/** §5.AB task-difficulty label (trivial → very-hard) when estimated. */
	difficulty: z.string().nullable(),
	/** §5.AF/§5.Z FLOW the attempt ran under (e.g. `board` task / `chat` / `autonomous`) — distinguishes non-board attempts. */
	flow: z.string().nullable(),
	startedAt: z.number().nullable(),
	completedAt: z.number().nullable(),
	ttftMs: z.number().nullable(),
	tokensPerSec: z.number().nullable(),
	toolCalls: z.array(attemptToolCallSchema),
	/**
	 * P21.14: total tool calls in the task's transcript AT CAPTURE TIME — the watermark that makes `toolCalls`
	 * above THIS attempt's calls rather than the whole task's.
	 *
	 * The transcript accumulates across a task's attempts and every terminal capture re-read all of it, so the
	 * same calls were recorded once per attempt (measured: one fingerprint 12x, `retriesBefore` reaching 14 on a
	 * card that succeeded first try). The next attempt slices from the highest watermark its predecessors
	 * recorded.
	 *
	 * NULL on lines written before this field existed — treated as 0, which reproduces the old behaviour for one
	 * more capture per task rather than silently reinterpreting historical counts as deltas.
	 */
	transcriptToolCallCount: z.number().nullable().default(null),
	/** F12.29: procedural-skill ids surfaced into this attempt's prompt (from the F4.19 fragment keys); [] = none. */
	surfacedSkillIds: z.array(z.string()).default([]),
	outcome: modelOutcomeKindSchema,
	qualityScore: z.number().nullable(),
	qualityOk: z.boolean().nullable(),
	/** Rung index in the retry ladder (0 = first try). */
	retriesBefore: z.number(),
	/** What recovery fired (looped→salvaged, recovered-narrated-call, …), when any. */
	salvage: z.string().nullable(),
	artifacts: attemptArtifactsSchema.nullable(),
	/** F1.1 knowledge-tool usage summary; null on events written before the field existed. */
	knowledge: attemptKnowledgeUsageSchema.nullable().default(null),
	/** F1.21: taint labels the session accumulated (broker state at terminal) — the delivery gate reads them. */
	taintLabels: z.array(z.string()).optional(),
	/** F1.5 — the canonical current focus-chain step at terminal time (`currentFocusChainStep`); null when none. */
	focusStep: z.string().nullable().default(null),
});

/** kind="transition" — a controller finite-state transition (§5.AF #2: the harness owns global process transitions). */
const transitionEventSchema = z.object({
	...ledgerEnvelopeShape,
	kind: z.literal("transition"),
	from: z.string().nullable(),
	to: z.string(),
	reason: z.string().nullable(),
	controllerDecision: z.string().nullable(),
});

/** kind="scheduler" — a durable-scheduler lease/lifecycle/admission event (§5.AF durable scheduler). */
const schedulerEventSchema = z.object({
	...ledgerEnvelopeShape,
	kind: z.literal("scheduler"),
	event: schedulerEventNameSchema,
	leaseId: z.string().nullable(),
	workerId: z.string().nullable(),
	idempotencyKey: z.string().nullable(),
	detail: z.string().nullable(),
});

/** Whether a retrieval turn HELPED the attempt's outcome, HURT it (a distractor misled), was NEUTRAL, or is UNKNOWN. */
export const retrievalSignalSchema = z.enum(["helped", "hurt", "neutral", "unknown"]);
export type RetrievalSignal = z.infer<typeof retrievalSignalSchema>;

/**
 * kind="retrieval" — a §5.AC retrieval turn: the query run, how many hits were considered vs pruned as distractors,
 * the citations kept, and whether it HELPED the attempt (the §5.AF "record attempts / pruned distractors / citations /
 * signal" evidence). Ledgered so the retrieval loop's usefulness is a query over the same substrate as attempts.
 */
const retrievalEventSchema = z.object({
	...ledgerEnvelopeShape,
	kind: z.literal("retrieval"),
	/** The attempt this retrieval served (null when it ran outside a scored attempt). */
	attemptId: z.string().nullable(),
	/** The search query that was run. */
	query: z.string(),
	/** Total hits the loop considered before pruning. */
	hitsConsidered: z.number(),
	/** How many hits were pruned as irrelevant distractors (≤ hitsConsidered). */
	distractorsPruned: z.number(),
	/** The source ids / urls actually cited in the synthesized answer. */
	citations: z.array(z.string()),
	/** Whether the retrieval helped, hurt, or was neutral for the outcome (the helped-or-hurt learning signal). */
	signal: retrievalSignalSchema,
});

/**
 * kind="research_freshness" — the decomposition preflight's explicit stale-vs-fresh decision. This is deliberately
 * separate from `retrieval`: a fresh cache hit SKIPS network retrieval and must never inflate retrieval-call metrics.
 * `evidenceAt` is the time cited online evidence was last observed (null when no usable evidence exists); citations
 * make both the search and skip branches independently auditable.
 */
const researchFreshnessEventSchema = z.object({
	...ledgerEnvelopeShape,
	kind: z.literal("research_freshness"),
	topicKey: z.string(),
	query: z.string(),
	action: z.enum(["retrieve_online", "use_local"]),
	verdict: z.enum(["current", "recent", "possibly_stale", "stale", "unknown"]),
	reason: z.string(),
	knowledgeAtBefore: z.number().nullable(),
	evidenceAt: z.number().nullable(),
	searchAttempted: z.boolean(),
	searchSucceeded: z.boolean(),
	citations: z.array(z.string()),
});

/** kind="retry" — one resolved adaptive remedy rung, including the failure that selected it and its measured cost. */
const retryStrategyEventSchema = z.object({
	...ledgerEnvelopeShape,
	kind: z.literal("retry"),
	/** Canonical provider:model:endpoint identity, aligned with terminal attempt events. */
	modelId: z.string(),
	/** Failure observed immediately before policy selected this rung. */
	triggerOutcome: modelOutcomeKindSchema,
	strategy: retryStrategySchema,
	/** Concrete executor label (for example prompt_variant:explicit_format). */
	strategyLabel: z.string().nullable(),
	/** Outcome of the model turn the rung drove. */
	resultOutcome: modelOutcomeKindSchema,
	recovered: z.boolean(),
	durationMs: z.number().nonnegative().nullable(),
	totalTokens: z.number().nonnegative().nullable(),
});

/** F4.27 — one immutable community-skill provenance/effectiveness lifecycle event. */
export const communitySkillLedgerEventSchema = z.object({
	...ledgerEnvelopeShape,
	kind: z.literal("community_skill"),
	stage: z.enum(["scan", "import", "execution_review", "execution_approval", "admission", "effectiveness"]),
	skillId: z.string().min(1),
	snapshotId: z.string().nullable(),
	activationId: z.string().nullable(),
	sessionId: z.string().nullable(),
	contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
	version: z.string().nullable(),
	/** Original user-reviewed source locator. Never a host path or skill body. */
	source: z.string().min(1),
	scanVerdicts: z
		.object({
			bundle: z.enum(["safe", "review", "reject"]),
			executable: z.enum(["safe", "quarantine"]),
			injection: z.enum(["safe", "review", "reject"]),
		})
		.strict()
		.nullable(),
	importVerdict: z.enum(["allow", "review", "reject", "unknown"]).nullable(),
	executionVerdict: z.enum(["allow", "approval-required", "deny"]).nullable(),
	grant: z
		.object({
			grantedTools: z.array(z.string()),
			effectiveTools: z.array(z.string()),
			deniedTools: z.array(z.string()),
			networkPolicy: z.enum(["none", "allowlist"]).nullable(),
			credentialMode: z.enum(["none", "task-scoped-egress-only"]).nullable(),
		})
		.strict()
		.nullable(),
	/** Exact path+digest approvals only. No executable bytes or credential values enter the ledger. */
	approvals: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()),
	effectivenessSignal: retrievalSignalSchema,
	effectivenessBasis: z.enum(["none", "acceptance", "operator", "paired_evaluation"]),
	evidenceRef: z.string().nullable(),
});

/** The full ledger event — a discriminated union on `kind` (extensible: add an event-kind schema to the union). */
export const agentLedgerEventSchema = z
	.discriminatedUnion("kind", [
		attemptEventSchema,
		transitionEventSchema,
		schedulerEventSchema,
		retrievalEventSchema,
		researchFreshnessEventSchema,
		retryStrategyEventSchema,
		communitySkillLedgerEventSchema,
	])
	.superRefine((event, context) => {
		if (event.kind === "retry" && event.recovered !== (event.resultOutcome === "success")) {
			context.addIssue({
				code: "custom",
				path: ["recovered"],
				message: "retry recovered must equal (resultOutcome === success)",
			});
		}
		if (event.kind === "research_freshness") {
			const retrievalRequired = event.action === "retrieve_online";
			if (event.searchAttempted !== retrievalRequired) {
				context.addIssue({
					code: "custom",
					path: ["searchAttempted"],
					message: "research freshness searchAttempted must equal (action === retrieve_online)",
				});
			}
			if (event.searchSucceeded && (event.evidenceAt === null || event.citations.length === 0)) {
				context.addIssue({
					code: "custom",
					path: ["searchSucceeded"],
					message: "successful research freshness search requires dated, cited evidence",
				});
			}
			if (event.evidenceAt !== null && event.citations.length === 0) {
				context.addIssue({
					code: "custom",
					path: ["citations"],
					message: "dated research freshness evidence requires at least one citation",
				});
			}
		}
		if (event.kind === "community_skill") {
			if ((event.stage === "scan" || event.stage === "import") && (!event.scanVerdicts || !event.importVerdict)) {
				context.addIssue({
					code: "custom",
					path: ["scanVerdicts"],
					message: "community-skill scan/import events require scan and import verdicts",
				});
			}
			if (
				(event.stage === "execution_review" ||
					event.stage === "execution_approval" ||
					event.stage === "admission") &&
				(!event.executionVerdict || !event.grant)
			) {
				context.addIssue({
					code: "custom",
					path: ["executionVerdict"],
					message: "community-skill execution events require an execution verdict and effective grant",
				});
			}
			const isEffectiveness = event.stage === "effectiveness";
			const effectivenessFieldsValid = isEffectiveness
				? event.effectivenessBasis !== "none" && event.effectivenessSignal !== "unknown"
				: event.effectivenessBasis === "none" && event.effectivenessSignal === "unknown";
			if (!effectivenessFieldsValid) {
				context.addIssue({
					code: "custom",
					path: ["effectivenessSignal"],
					message: "only effectiveness events may carry a known signal and evidence basis",
				});
			}
		}
	});
export type AgentLedgerEvent = z.infer<typeof agentLedgerEventSchema>;
export type AgentAttemptEvent = z.infer<typeof attemptEventSchema>;
export type AgentTransitionEvent = z.infer<typeof transitionEventSchema>;
export type AgentSchedulerEvent = z.infer<typeof schedulerEventSchema>;
export type AgentRetrievalEvent = z.infer<typeof retrievalEventSchema>;
export type AgentResearchFreshnessEvent = z.infer<typeof researchFreshnessEventSchema>;
export type AgentRetryStrategyEvent = z.infer<typeof retryStrategyEventSchema>;
export type AgentCommunitySkillEvent = z.infer<typeof communitySkillLedgerEventSchema>;

/** Shared envelope inputs (the builder fills `schemaVersion`/`eventId`/`recordedAt` if not given). */
interface LedgerEnvelopeInput {
	workflowId: string;
	taskId: string;
	workspacePathHash: string;
	role?: string | null;
	/** Stable id for the event; defaults to a random uuid (pass explicitly in tests for determinism). */
	eventId?: string;
	recordedAt?: number;
}

function buildEnvelope(input: LedgerEnvelopeInput): {
	schemaVersion: 1;
	eventId: string;
	recordedAt: number;
	workflowId: string;
	taskId: string;
	workspacePathHash: string;
	role: string | null;
} {
	return {
		schemaVersion: 1,
		eventId: input.eventId ?? randomUUID(),
		recordedAt: input.recordedAt ?? Date.now(),
		workflowId: input.workflowId,
		taskId: input.taskId,
		workspacePathHash: input.workspacePathHash,
		role: input.role ?? null,
	};
}

export interface BuildAttemptEventInput extends LedgerEnvelopeInput {
	attemptId: string;
	parentAttemptId?: string | null;
	modelId: string;
	endpoint?: string | null;
	endpointStrategy?: string | null;
	promptStrategy?: string | null;
	toolSetOffered?: string[];
	simplificationLevel?: number;
	contextTokens?: number | null;
	contextBudgetTarget?: number | null;
	difficulty?: string | null;
	flow?: string | null;
	startedAt?: number | null;
	completedAt?: number | null;
	ttftMs?: number | null;
	tokensPerSec?: number | null;
	reasoningTokens?: number | null;
	toolCalls?: AttemptToolCall[];
	/** P21.14: total tool calls in the transcript at capture time; null = unknown (legacy-shaped write). */
	transcriptToolCallCount?: number | null;
	surfacedSkillIds?: readonly string[];
	outcome: ModelOutcomeKind;
	qualityScore?: number | null;
	qualityOk?: boolean | null;
	retriesBefore?: number;
	salvage?: string | null;
	artifacts?: AttemptArtifacts | null;
	knowledge?: AttemptKnowledgeUsage | null;
	taintLabels?: readonly string[];
	focusStep?: string | null;
}

/** Build a validated `attempt` event, filling unspecified fields with nulls/empties. */
export function buildAttemptEvent(input: BuildAttemptEventInput): AgentAttemptEvent {
	return {
		...buildEnvelope(input),
		kind: "attempt",
		attemptId: input.attemptId,
		parentAttemptId: input.parentAttemptId ?? null,
		modelId: input.modelId,
		endpoint: input.endpoint ?? null,
		endpointStrategy: input.endpointStrategy ?? null,
		promptStrategy: input.promptStrategy ?? null,
		toolSetOffered: input.toolSetOffered ? [...input.toolSetOffered] : [],
		simplificationLevel: input.simplificationLevel ?? 0,
		contextTokens: input.contextTokens ?? null,
		contextBudgetTarget: input.contextBudgetTarget ?? null,
		difficulty: input.difficulty ?? null,
		flow: input.flow ?? null,
		startedAt: input.startedAt ?? null,
		completedAt: input.completedAt ?? null,
		ttftMs: input.ttftMs ?? null,
		tokensPerSec: input.tokensPerSec ?? null,
		reasoningTokens: input.reasoningTokens ?? null,
		toolCalls: input.toolCalls ? input.toolCalls.map((call) => ({ ...call })) : [],
		transcriptToolCallCount: input.transcriptToolCallCount ?? null,
		surfacedSkillIds: input.surfacedSkillIds ? [...input.surfacedSkillIds] : [],
		outcome: input.outcome,
		qualityScore: input.qualityScore ?? null,
		qualityOk: input.qualityOk ?? null,
		retriesBefore: input.retriesBefore ?? 0,
		salvage: input.salvage ?? null,
		artifacts: input.artifacts ? { ...input.artifacts } : null,
		knowledge: input.knowledge ? { ...input.knowledge, categoriesUsed: [...input.knowledge.categoriesUsed] } : null,
		...(input.taintLabels ? { taintLabels: [...input.taintLabels] } : {}),
		focusStep: input.focusStep ?? null,
	};
}

export interface BuildTransitionEventInput extends LedgerEnvelopeInput {
	from?: string | null;
	to: string;
	reason?: string | null;
	controllerDecision?: string | null;
}

export interface BuildRetryStrategyEventInput extends LedgerEnvelopeInput {
	modelId: string;
	triggerOutcome: ModelOutcomeKind;
	strategy: RetryStrategy;
	strategyLabel?: string | null;
	resultOutcome: ModelOutcomeKind;
	durationMs?: number | null;
	totalTokens?: number | null;
}

/** Build one durable adaptive-rung resolution event. */
export function buildRetryStrategyEvent(input: BuildRetryStrategyEventInput): AgentRetryStrategyEvent {
	return {
		...buildEnvelope(input),
		kind: "retry",
		modelId: input.modelId,
		triggerOutcome: input.triggerOutcome,
		strategy: input.strategy,
		strategyLabel: input.strategyLabel ?? null,
		resultOutcome: input.resultOutcome,
		recovered: input.resultOutcome === "success",
		durationMs: input.durationMs ?? null,
		totalTokens: input.totalTokens ?? null,
	};
}

/** Build a validated controller `transition` event. */
export function buildTransitionEvent(input: BuildTransitionEventInput): AgentTransitionEvent {
	return {
		...buildEnvelope(input),
		kind: "transition",
		from: input.from ?? null,
		to: input.to,
		reason: input.reason ?? null,
		controllerDecision: input.controllerDecision ?? null,
	};
}

export interface BuildSchedulerEventInput extends LedgerEnvelopeInput {
	event: SchedulerEventName;
	leaseId?: string | null;
	workerId?: string | null;
	idempotencyKey?: string | null;
	detail?: string | null;
}

/** Build a validated durable-scheduler `scheduler` event. */
export function buildSchedulerEvent(input: BuildSchedulerEventInput): AgentSchedulerEvent {
	return {
		...buildEnvelope(input),
		kind: "scheduler",
		event: input.event,
		leaseId: input.leaseId ?? null,
		workerId: input.workerId ?? null,
		idempotencyKey: input.idempotencyKey ?? null,
		detail: input.detail ?? null,
	};
}

export interface BuildRetrievalEventInput extends LedgerEnvelopeInput {
	query: string;
	attemptId?: string | null;
	hitsConsidered?: number;
	distractorsPruned?: number;
	citations?: readonly string[];
	signal?: RetrievalSignal;
}

/**
 * Build a validated §5.AC `retrieval` event. Counts default to 0 and `signal` to `unknown`; `distractorsPruned` is
 * clamped to `[0, hitsConsidered]` (you cannot prune more distractors than hits considered) and citations de-duplicated
 * in first-seen order (a citation list is a set of sources, not a bag).
 */
export function buildRetrievalEvent(input: BuildRetrievalEventInput): AgentRetrievalEvent {
	const hitsConsidered = Math.max(0, Math.trunc(input.hitsConsidered ?? 0));
	const distractorsPruned = Math.max(0, Math.min(hitsConsidered, Math.trunc(input.distractorsPruned ?? 0)));
	const citations = [...new Set((input.citations ?? []).map((c) => c.trim()).filter((c) => c.length > 0))];
	return {
		...buildEnvelope(input),
		kind: "retrieval",
		attemptId: input.attemptId ?? null,
		query: input.query,
		hitsConsidered,
		distractorsPruned,
		citations,
		signal: input.signal ?? "unknown",
	};
}

export interface BuildResearchFreshnessEventInput extends LedgerEnvelopeInput {
	topicKey: string;
	query: string;
	action: AgentResearchFreshnessEvent["action"];
	verdict: AgentResearchFreshnessEvent["verdict"];
	reason: string;
	knowledgeAtBefore?: number | null;
	evidenceAt?: number | null;
	searchAttempted: boolean;
	searchSucceeded: boolean;
	citations?: readonly string[];
}

/** Build one validated decomposition freshness decision without pretending that a skipped refresh was retrieval. */
export function buildResearchFreshnessEvent(input: BuildResearchFreshnessEventInput): AgentResearchFreshnessEvent {
	return {
		...buildEnvelope(input),
		kind: "research_freshness",
		topicKey: input.topicKey.trim(),
		query: input.query.trim(),
		action: input.action,
		verdict: input.verdict,
		reason: input.reason.trim(),
		knowledgeAtBefore: input.knowledgeAtBefore ?? null,
		evidenceAt: input.evidenceAt ?? null,
		searchAttempted: input.searchAttempted,
		searchSucceeded: input.searchSucceeded,
		citations: [...new Set((input.citations ?? []).map((citation) => citation.trim()).filter(Boolean))],
	};
}

export interface BuildCommunitySkillEventInput extends LedgerEnvelopeInput {
	stage: AgentCommunitySkillEvent["stage"];
	skillId: string;
	snapshotId?: string | null;
	activationId?: string | null;
	sessionId?: string | null;
	contentHash: string;
	version?: string | null;
	source: string;
	scanVerdicts?: AgentCommunitySkillEvent["scanVerdicts"];
	importVerdict?: AgentCommunitySkillEvent["importVerdict"];
	executionVerdict?: AgentCommunitySkillEvent["executionVerdict"];
	grant?: AgentCommunitySkillEvent["grant"];
	approvals?: readonly { path: string; sha256: string }[];
	effectivenessSignal?: RetrievalSignal;
	effectivenessBasis?: AgentCommunitySkillEvent["effectivenessBasis"];
	evidenceRef?: string | null;
}

function sortedUniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function safeCommunitySkillLedgerSource(value: string): string {
	const trimmed = value.trim();
	try {
		const url = new URL(trimmed);
		if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported source protocol");
		url.username = "";
		url.password = "";
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return `redacted-source-sha256:${createHash("sha256").update(trimmed).digest("hex")}`;
	}
}

/** Build a bounded, body-free F4.27 provenance event and enforce its lifecycle-specific invariants. */
export function buildCommunitySkillEvent(input: BuildCommunitySkillEventInput): AgentCommunitySkillEvent {
	const grant = input.grant
		? {
				...input.grant,
				grantedTools: sortedUniqueStrings(input.grant.grantedTools),
				effectiveTools: sortedUniqueStrings(input.grant.effectiveTools),
				deniedTools: sortedUniqueStrings(input.grant.deniedTools),
			}
		: null;
	return agentLedgerEventSchema.parse({
		...buildEnvelope(input),
		kind: "community_skill",
		stage: input.stage,
		skillId: input.skillId.trim(),
		snapshotId: input.snapshotId ?? null,
		activationId: input.activationId ?? null,
		sessionId: input.sessionId ?? null,
		contentHash: input.contentHash,
		version: input.version ?? null,
		source: safeCommunitySkillLedgerSource(input.source),
		scanVerdicts: input.scanVerdicts ?? null,
		importVerdict: input.importVerdict ?? null,
		executionVerdict: input.executionVerdict ?? null,
		grant,
		approvals: [...(input.approvals ?? [])]
			.map((approval) => ({ path: approval.path.trim(), sha256: approval.sha256 }))
			.sort((left, right) => left.path.localeCompare(right.path)),
		effectivenessSignal: input.effectivenessSignal ?? "unknown",
		effectivenessBasis: input.effectivenessBasis ?? "none",
		evidenceRef: input.evidenceRef ?? null,
	}) as AgentCommunitySkillEvent;
}

export const communitySkillLedgerReportRequestSchema = z
	.object({
		skillId: z.string().min(1).optional(),
		taskId: z.string().min(1).optional(),
		sessionId: z.string().min(1).optional(),
		limit: z.number().int().positive().max(1_000).default(200),
	})
	.strict();
export type CommunitySkillLedgerReportRequest = z.infer<typeof communitySkillLedgerReportRequestSchema>;

export const communitySkillLedgerReportSchema = z
	.object({
		events: z.array(communitySkillLedgerEventSchema),
		summary: z
			.object({
				total: z.number().int().nonnegative(),
				helped: z.number().int().nonnegative(),
				hurt: z.number().int().nonnegative(),
				neutral: z.number().int().nonnegative(),
				unknown: z.number().int().nonnegative(),
			})
			.strict(),
	})
	.strict();
export type CommunitySkillLedgerReport = z.infer<typeof communitySkillLedgerReportSchema>;

/** Query the provenance stream without exposing unrelated attempt or scheduler records. */
export function buildCommunitySkillLedgerReport(
	events: readonly AgentLedgerEvent[],
	request: CommunitySkillLedgerReportRequest,
): CommunitySkillLedgerReport {
	const matching = events.filter(
		(event): event is AgentCommunitySkillEvent =>
			event.kind === "community_skill" &&
			(!request.skillId || event.skillId === request.skillId) &&
			(!request.taskId || event.taskId === request.taskId) &&
			(!request.sessionId || event.sessionId === request.sessionId),
	);
	const eventsWithinLimit = matching.slice(Math.max(0, matching.length - request.limit));
	const summary = { total: matching.length, helped: 0, hurt: 0, neutral: 0, unknown: 0 };
	for (const event of matching) {
		if (event.stage === "effectiveness") summary[event.effectivenessSignal] += 1;
	}
	return { events: eventsWithinLimit, summary };
}

// ─── Projections (the keystone value: the §5.AA profile / §5.AB fitness / §5.Z matrix become queries over this) ───

/** One row of the §5.AG escalation chain — what was tried at one rung. */
export interface TaskAttemptRow {
	rung: number;
	modelId: string;
	/** A readable label for the levers applied this rung (endpoint/prompt/tool-set-simplification). */
	approach: string;
	outcome: AgentAttemptEvent["outcome"];
	qualityScore: number | null;
	qualityOk: boolean | null;
	salvage: string | null;
	recordedAt: number;
}

export interface TaskEscalationReport {
	taskId: string;
	totalAttempts: number;
	/** Distinct models tried, in first-seen order. */
	modelsTried: string[];
	finalOutcome: AgentAttemptEvent["outcome"] | null;
	/** Chronological attempt chain (oldest → newest). */
	attempts: TaskAttemptRow[];
}

/** Request for the §5.AG escalation report of a single task. */
export const taskEscalationReportRequestSchema = z.object({ taskId: z.string().min(1) });
export type TaskEscalationReportRequest = z.infer<typeof taskEscalationReportRequestSchema>;

export const taskAttemptRowSchema = z.object({
	rung: z.number(),
	modelId: z.string(),
	approach: z.string(),
	outcome: modelOutcomeKindSchema,
	qualityScore: z.number().nullable(),
	qualityOk: z.boolean().nullable(),
	salvage: z.string().nullable(),
	recordedAt: z.number(),
});

export const taskEscalationReportSchema = z.object({
	taskId: z.string(),
	totalAttempts: z.number(),
	modelsTried: z.array(z.string()),
	finalOutcome: modelOutcomeKindSchema.nullable(),
	attempts: z.array(taskAttemptRowSchema),
});
// Compile-time drift guard: keep the wire schema in lockstep with the projection's return type.
const _escalationReportGuard: z.ZodType<TaskEscalationReport> = taskEscalationReportSchema;
void _escalationReportGuard;

function describeAttemptApproach(attempt: AgentAttemptEvent): string {
	const parts: string[] = [];
	if (attempt.endpointStrategy) {
		parts.push(`endpoint:${attempt.endpointStrategy}`);
	}
	if (attempt.promptStrategy) {
		parts.push(`prompt:${attempt.promptStrategy}`);
	}
	if (attempt.simplificationLevel > 0) {
		parts.push(`simplify:${attempt.simplificationLevel}`);
	}
	return parts.length > 0 ? parts.join(" ") : "default";
}

/**
 * The §5.AG "what was tried before escalating" report for one task: its attempt chain (rung × model × approach ×
 * outcome × score) in chronological order, plus a rollup (distinct models tried, final outcome). Pure projection over
 * the ledger, so the operator escalation surface is a QUERY over the durable record, not a parallel store — the user
 * sees an actionable report instead of a silent dead end.
 */
export function buildTaskEscalationReport(events: readonly AgentLedgerEvent[], taskId: string): TaskEscalationReport {
	const attempts = selectAttempts(events)
		.filter((event) => event.taskId === taskId)
		.sort((left, right) => left.recordedAt - right.recordedAt);
	const rows: TaskAttemptRow[] = attempts.map((attempt) => ({
		rung: attempt.retriesBefore,
		modelId: attempt.modelId,
		approach: describeAttemptApproach(attempt),
		outcome: attempt.outcome,
		qualityScore: attempt.qualityScore,
		qualityOk: attempt.qualityOk,
		salvage: attempt.salvage,
		recordedAt: attempt.recordedAt,
	}));
	const modelsTried: string[] = [];
	for (const row of rows) {
		if (!modelsTried.includes(row.modelId)) {
			modelsTried.push(row.modelId);
		}
	}
	return {
		taskId,
		totalAttempts: rows.length,
		modelsTried,
		finalOutcome: rows.length > 0 ? (rows[rows.length - 1] as TaskAttemptRow).outcome : null,
		attempts: rows,
	};
}

/** A per-model outcome rollup — the §5.Z cross-model matrix + the §5.AA profile feed, as a pure ledger query. */
export interface ModelOutcomeRollup {
	modelId: string;
	samples: number;
	successes: number;
	successRate: number;
	byOutcome: Record<ModelOutcomeKind, number>;
}

function emptyOutcomeCounts(): Record<ModelOutcomeKind, number> {
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

/**
 * Roll up attempts per model into outcome counts + success rate (sorted by samples desc, then modelId). The §5.Z matrix
 * and the §5.AA `ModelBehaviorProfile` are projections of this — one evidence source, no parallel persistence.
 */
export function summarizeModelOutcomes(events: readonly AgentLedgerEvent[]): ModelOutcomeRollup[] {
	const byModel = new Map<string, Record<ModelOutcomeKind, number>>();
	for (const attempt of selectAttempts(events)) {
		const counts = byModel.get(attempt.modelId) ?? emptyOutcomeCounts();
		counts[attempt.outcome] += 1;
		byModel.set(attempt.modelId, counts);
	}
	const rollups: ModelOutcomeRollup[] = [];
	for (const [modelId, byOutcome] of byModel) {
		const samples = Object.values(byOutcome).reduce((sum, count) => sum + count, 0);
		const successes = byOutcome.success;
		rollups.push({
			modelId,
			samples,
			successes,
			successRate: samples > 0 ? successes / samples : 0,
			byOutcome,
		});
	}
	rollups.sort((left, right) => right.samples - left.samples || left.modelId.localeCompare(right.modelId));
	return rollups;
}

export interface ModelContextUsageRollup {
	modelId: string;
	/** Attempts that recorded a prompt-token count. */
	samples: number;
	avgContextTokens: number | null;
	maxContextTokens: number | null;
	/** Attempts whose prompt exceeded the recorded `contextBudgetTarget` (when both are present) — overflow pressure. */
	overBudget: number;
}

/**
 * Roll up per-model CONTEXT usage from the ledger's attempt records (todo §5.AF / §5.AD) — the `contextTokens` the
 * terminal writer captures (prompt size), with avg + max + an over-budget count (prompt > `contextBudgetTarget` when
 * both are set). A §5.AD budget-tuning + §5.AB routing input: a model that routinely runs near or over its window is a
 * candidate for smart-zone trimming or a larger-context peer. Only attempts that recorded a prompt size count. Sorted by
 * samples desc, then modelId.
 */
export function summarizeModelContextUsage(events: readonly AgentLedgerEvent[]): ModelContextUsageRollup[] {
	const byModel = new Map<string, { tokens: number[]; overBudget: number }>();
	for (const attempt of selectAttempts(events)) {
		if (typeof attempt.contextTokens !== "number") {
			continue;
		}
		const entry = byModel.get(attempt.modelId) ?? { tokens: [], overBudget: 0 };
		entry.tokens.push(attempt.contextTokens);
		if (typeof attempt.contextBudgetTarget === "number" && attempt.contextTokens > attempt.contextBudgetTarget) {
			entry.overBudget += 1;
		}
		byModel.set(attempt.modelId, entry);
	}
	const rollups: ModelContextUsageRollup[] = [];
	for (const [modelId, { tokens, overBudget }] of byModel) {
		rollups.push({
			modelId,
			samples: tokens.length,
			avgContextTokens: meanOrNull(tokens),
			maxContextTokens: tokens.length > 0 ? Math.max(...tokens) : null,
			overBudget,
		});
	}
	rollups.sort((left, right) => right.samples - left.samples || left.modelId.localeCompare(right.modelId));
	return rollups;
}

export interface ModelSpeedRollup {
	modelId: string;
	/** Attempts that carried at least one speed datum (ttft or tok/s) — the denominator for these stats. */
	samples: number;
	avgTtftMs: number | null;
	medianTtftMs: number | null;
	avgTokensPerSec: number | null;
	medianTokensPerSec: number | null;
}

/** Mean of a non-empty numeric list, or null when empty. */
/**
 * Roll up per-model SPEED from the ledger's attempt records (todo §5.AF — a pure projection over the same one stream,
 * not a parallel store). Uses the `ttftMs` + `tokensPerSec` the terminal writer computes; only attempts that carried a
 * datum count toward each stat (a model with no timing samples reports null, not a misleading 0). Speed is a §5.AB
 * selection signal — slow-but-capable vs fast-but-weak is a real routing trade-off. Sorted by samples desc, then modelId.
 */
export function summarizeModelSpeed(events: readonly AgentLedgerEvent[]): ModelSpeedRollup[] {
	const ttftByModel = new Map<string, number[]>();
	const tpsByModel = new Map<string, number[]>();
	// Count distinct datum-carrying ATTEMPTS per model — NOT max(ttft.length, tps.length), which undercounts when
	// attempts split their metric coverage (some ttft-only, some tps-only): neither list alone covers every attempt.
	const sampleCountByModel = new Map<string, number>();
	const pushSample = (map: Map<string, number[]>, modelId: string, value: number): void => {
		const list = map.get(modelId);
		if (list) {
			list.push(value);
		} else {
			map.set(modelId, [value]);
		}
	};
	for (const attempt of selectAttempts(events)) {
		const hasTtft = typeof attempt.ttftMs === "number";
		const hasTps = typeof attempt.tokensPerSec === "number";
		if (!hasTtft && !hasTps) {
			continue;
		}
		sampleCountByModel.set(attempt.modelId, (sampleCountByModel.get(attempt.modelId) ?? 0) + 1);
		if (hasTtft) {
			pushSample(ttftByModel, attempt.modelId, attempt.ttftMs as number);
		}
		if (hasTps) {
			pushSample(tpsByModel, attempt.modelId, attempt.tokensPerSec as number);
		}
	}
	const rollups: ModelSpeedRollup[] = [];
	for (const modelId of sampleCountByModel.keys()) {
		const ttft = ttftByModel.get(modelId) ?? [];
		const tps = tpsByModel.get(modelId) ?? [];
		rollups.push({
			modelId,
			samples: sampleCountByModel.get(modelId) ?? 0,
			avgTtftMs: meanOrNull(ttft),
			medianTtftMs: medianOrNull(ttft),
			avgTokensPerSec: meanOrNull(tps),
			medianTokensPerSec: medianOrNull(tps),
		});
	}
	rollups.sort((left, right) => right.samples - left.samples || left.modelId.localeCompare(right.modelId));
	return rollups;
}

export interface ModelToolUsageRollup {
	modelId: string;
	toolName: string;
	calls: number;
	successes: number;
	errors: number;
	/** Calls with no recorded outcome — the run ended before the tool returned. */
	incomplete: number;
	/** successes / (successes + errors), i.e. over *completed* calls only; 0 when none completed. */
	successRate: number;
}

/**
 * Roll up the per-tool-call detail (written by the terminal writer via `extractTerminalToolCalls`) into per-(model,
 * tool) usage + outcome counts — which tools each model leans on and where it fails. The §5.AA small-model signal: a
 * weak model that reliably errors on a specific tool is a parse-and-recover / tool-simplification target, not just a
 * "bad model". Sorted by calls desc, then modelId, then toolName.
 */
/** F1.1 — one (model × role) row correlating knowledge consultation with delivery outcome. */
export interface KnowledgeOutcomeSummaryRow {
	modelId: string;
	role: string;
	/** Attempts that consulted knowledge tools (retrievalCallCount > 0). */
	attemptsWithKnowledge: number;
	successesWithKnowledge: number;
	/** Attempts with a knowledge summary that did NOT consult knowledge tools. */
	attemptsWithoutKnowledge: number;
	successesWithoutKnowledge: number;
	/** successRate(with) − successRate(without); null until BOTH sides have evidence. */
	knowledgeLift: number | null;
}

/**
 * F1.1 — correlate knowledge-tool consultation with delivery outcome, per (model × role). Only attempts that CARRY a
 * knowledge summary contribute (events written before the field existed are skipped, never counted as "no knowledge").
 * Pure projection over the ledger — the join key is the attempt event itself, which holds both sides.
 */
export function summarizeKnowledgeOutcomeByModel(events: readonly AgentLedgerEvent[]): KnowledgeOutcomeSummaryRow[] {
	const rows = new Map<string, KnowledgeOutcomeSummaryRow>();
	for (const event of events) {
		if (event.kind !== "attempt" || !event.knowledge) {
			continue;
		}
		const role = event.role ?? "unknown";
		const key = `${event.modelId}::${role}`;
		const existing = rows.get(key);
		const row: KnowledgeOutcomeSummaryRow = existing ?? {
			modelId: event.modelId,
			role,
			attemptsWithKnowledge: 0,
			successesWithKnowledge: 0,
			attemptsWithoutKnowledge: 0,
			successesWithoutKnowledge: 0,
			knowledgeLift: null,
		};
		if (!existing) {
			rows.set(key, row);
		}
		const succeeded = event.outcome === "success";
		if (event.knowledge.retrievalCallCount > 0) {
			row.attemptsWithKnowledge += 1;
			if (succeeded) {
				row.successesWithKnowledge += 1;
			}
		} else {
			row.attemptsWithoutKnowledge += 1;
			if (succeeded) {
				row.successesWithoutKnowledge += 1;
			}
		}
	}
	for (const row of rows.values()) {
		if (row.attemptsWithKnowledge > 0 && row.attemptsWithoutKnowledge > 0) {
			row.knowledgeLift =
				row.successesWithKnowledge / row.attemptsWithKnowledge -
				row.successesWithoutKnowledge / row.attemptsWithoutKnowledge;
		}
	}
	return [...rows.values()].sort((a, b) => `${a.modelId}::${a.role}`.localeCompare(`${b.modelId}::${b.role}`));
}

/** F1.1 — correlate declared knowledge debt (on plan-born cards) with delivery outcome. */
export interface KnowledgeDebtOutcomeSummary {
	attemptsWithDebt: number;
	successesWithDebt: number;
	attemptsWithoutDebt: number;
	successesWithoutDebt: number;
	/** successRate(withDebt) − successRate(withoutDebt); null until both sides have evidence. */
	debtLift: number | null;
}

export function summarizeKnowledgeDebtOutcomes(events: readonly AgentLedgerEvent[]): KnowledgeDebtOutcomeSummary {
	const summary: KnowledgeDebtOutcomeSummary = {
		attemptsWithDebt: 0,
		successesWithDebt: 0,
		attemptsWithoutDebt: 0,
		successesWithoutDebt: 0,
		debtLift: null,
	};
	for (const event of events) {
		if (event.kind !== "attempt" || event.knowledge?.knowledgeDebtPresent == null) {
			continue;
		}
		const succeeded = event.outcome === "success";
		if (event.knowledge.knowledgeDebtPresent) {
			summary.attemptsWithDebt += 1;
			if (succeeded) {
				summary.successesWithDebt += 1;
			}
		} else {
			summary.attemptsWithoutDebt += 1;
			if (succeeded) {
				summary.successesWithoutDebt += 1;
			}
		}
	}
	if (summary.attemptsWithDebt > 0 && summary.attemptsWithoutDebt > 0) {
		summary.debtLift =
			summary.successesWithDebt / summary.attemptsWithDebt -
			summary.successesWithoutDebt / summary.attemptsWithoutDebt;
	}
	return summary;
}

/** F1.1 — one graph-revision (re-decompose round) bucket correlated with delivery outcome. */
export interface RedecomposeRoundOutcomeRow {
	/** 0 = the original decomposition's cards; N = cards spawned by the Nth re-decompose round. */
	round: number;
	attempts: number;
	successes: number;
}

/**
 * F1.1 — correlate GRAPH REVISIONS with delivery outcome: bucket attempts by the re-decompose round their task id
 * encodes (`parseRedecomposeRound` counts the `redecompose-` prefixes the escalation ladder stacks). Derived purely
 * at read time — no revision counter store required.
 */
export function summarizeRedecomposeRoundOutcomes(
	events: readonly AgentLedgerEvent[],
	parseRound: (taskId: string | null | undefined) => number,
): RedecomposeRoundOutcomeRow[] {
	const buckets = new Map<number, RedecomposeRoundOutcomeRow>();
	for (const event of events) {
		if (event.kind !== "attempt") {
			continue;
		}
		const round = parseRound(event.taskId);
		const existing = buckets.get(round);
		const row: RedecomposeRoundOutcomeRow = existing ?? { round, attempts: 0, successes: 0 };
		if (!existing) {
			buckets.set(round, row);
		}
		row.attempts += 1;
		if (event.outcome === "success") {
			row.successes += 1;
		}
	}
	return [...buckets.values()].sort((a, b) => a.round - b.round);
}

export function summarizeToolUsageByModel(events: readonly AgentLedgerEvent[]): ModelToolUsageRollup[] {
	const byKey = new Map<string, ModelToolUsageRollup>();
	for (const attempt of selectAttempts(events)) {
		for (const call of attempt.toolCalls) {
			const key = `${attempt.modelId}\u0000${call.name}`;
			const rollup = byKey.get(key) ?? {
				modelId: attempt.modelId,
				toolName: call.name,
				calls: 0,
				successes: 0,
				errors: 0,
				incomplete: 0,
				successRate: 0,
			};
			rollup.calls += 1;
			if (call.outcome === "success") {
				rollup.successes += 1;
			} else if (call.outcome === "error") {
				rollup.errors += 1;
			} else {
				rollup.incomplete += 1;
			}
			byKey.set(key, rollup);
		}
	}
	const rollups = [...byKey.values()];
	for (const rollup of rollups) {
		const completed = rollup.successes + rollup.errors;
		rollup.successRate = completed > 0 ? rollup.successes / completed : 0;
	}
	rollups.sort(
		(left, right) =>
			right.calls - left.calls ||
			left.modelId.localeCompare(right.modelId) ||
			left.toolName.localeCompare(right.toolName),
	);
	return rollups;
}

/** The tool names that MUTATE files — the ones whose success/error rate IS the "edit-format reliability" signal (P21.1). */
export const EDIT_TOOL_NAMES: readonly string[] = ["apply_patch", "editor", "write_file", "edit_file", "create_file"];

export interface ModelEditReliabilityRollup {
	modelId: string;
	/** Completed edit-tool calls (successes + errors) across ALL edit tools, per model. */
	editCalls: number;
	editSuccesses: number;
	editErrors: number;
	/** editSuccesses / editCalls over completed edit calls only; null when the model made no completed edit call. */
	successRate: number | null;
	/** Which edit tools this model actually used (so a diff-only vs whole-file model is visible), success-desc. */
	byTool: readonly { toolName: string; calls: number; successRate: number }[];
}

/**
 * P21.1 — roll the per-(model, tool) usage up into ONE edit-format-reliability number per model: the fraction of a
 * model's file-MUTATING calls (`apply_patch`/`editor`/`write_file`/`edit_file`/`create_file`) that SUCCEEDED. Aider's
 * data makes this a first-class routing dimension (whole-file 16.4% vs diff 8.0% on the same 32B — a 2× swing from
 * edit format alone), and it was previously only visible as scattered per-tool rows. `successRate` is `null` (never 0)
 * when a model made no completed edit call, so "we have no edit evidence for this model" stays distinct from "it fails
 * every edit" — the same absent-evidence-≠-capability rule as the fitness store. Derived purely from the existing
 * ledger outcomes (no new instrumentation); the coarse `is_error` grain proxies "struggles to edit", not specifically
 * "struggles with DIFF format" (see P21.1's note for the granularity limit).
 */
export function summarizeEditReliabilityByModel(
	events: readonly AgentLedgerEvent[],
	editToolNames: readonly string[] = EDIT_TOOL_NAMES,
): ModelEditReliabilityRollup[] {
	const editSet = new Set(editToolNames);
	const perTool = summarizeToolUsageByModel(events).filter((row) => editSet.has(row.toolName));
	const byModel = new Map<string, ModelEditReliabilityRollup>();
	for (const row of perTool) {
		const rollup = byModel.get(row.modelId) ?? {
			modelId: row.modelId,
			editCalls: 0,
			editSuccesses: 0,
			editErrors: 0,
			successRate: null,
			byTool: [],
		};
		rollup.editSuccesses += row.successes;
		rollup.editErrors += row.errors;
		rollup.editCalls = rollup.editSuccesses + rollup.editErrors;
		(rollup.byTool as { toolName: string; calls: number; successRate: number }[]).push({
			toolName: row.toolName,
			calls: row.calls,
			successRate: row.successRate,
		});
		byModel.set(row.modelId, rollup);
	}
	const rollups = [...byModel.values()];
	for (const rollup of rollups) {
		rollup.successRate = rollup.editCalls > 0 ? rollup.editSuccesses / rollup.editCalls : null;
		(rollup.byTool as { toolName: string; calls: number; successRate: number }[]).sort(
			(a, b) => b.calls - a.calls || a.toolName.localeCompare(b.toolName),
		);
	}
	// Most edit-active models first; a model with edit evidence outranks one without (null last).
	rollups.sort(
		(left, right) =>
			right.editCalls - left.editCalls ||
			(right.successRate ?? -1) - (left.successRate ?? -1) ||
			left.modelId.localeCompare(right.modelId),
	);
	return rollups;
}
