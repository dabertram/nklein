/**
 * The Agent Attempt Ledger (todo §5.AF) — the keystone evidence substrate.
 *
 * Every new ambition (§5.AA model-behaviour learning, §5.AB fitness/selection, §5.AC retrieval, §5.AD context quality,
 * §5.Z cross-model matrix, retry budgets, loop salvage, replay debugging, the durable scheduler, operator UX) consumes
 * or produces the SAME thing — a per-attempt outcome record — but today those outcomes evaporate into per-domain stores
 * (`task-run-summary-store`, model-registry observations, knowledge-tool telemetry) that share no grain or key. This is
 * the ONE durable evidence stream; the rest become projections of it.
 *
 * Per the 2026-06-27 small-LLM research refinement (`.plan/docs/small-llm-agent-optimization-research.md`), the ledger
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

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ModelOutcomeKind } from "./model-behavior-profile";

/** The classified model outcomes, as a zod enum kept in lock-step with `ModelOutcomeKind` (the typed-const guard below). */
const modelOutcomeKindSchema = z.enum([
	"success",
	"no_tool_call",
	"narrated",
	"loop",
	"timeout",
	"malformed",
	"other_failure",
]);
// Compile-time drift guard: if `ModelOutcomeKind` (§5.AA) changes, this assignment fails until the enum is updated.
const _outcomeKindGuard: z.ZodType<ModelOutcomeKind> = modelOutcomeKindSchema;
void _outcomeKindGuard;

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
] as const;
const schedulerEventNameSchema = z.enum(SCHEDULER_EVENT_NAMES);
export type SchedulerEventName = z.infer<typeof schedulerEventNameSchema>;

/** One tool call inside an attempt — name + lossless full-input fingerprint (§5.O) + its own outcome. */
const attemptToolCallSchema = z.object({
	name: z.string(),
	fingerprint: z.string().nullable(),
	outcome: z.string().nullable(),
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
	/** §5.AD context budget target in play. */
	contextBudgetTarget: z.number().nullable(),
	/** §5.AB task-difficulty label (trivial → very-hard) when estimated. */
	difficulty: z.string().nullable(),
	startedAt: z.number().nullable(),
	completedAt: z.number().nullable(),
	ttftMs: z.number().nullable(),
	tokensPerSec: z.number().nullable(),
	toolCalls: z.array(attemptToolCallSchema),
	outcome: modelOutcomeKindSchema,
	qualityScore: z.number().nullable(),
	qualityOk: z.boolean().nullable(),
	/** Rung index in the retry ladder (0 = first try). */
	retriesBefore: z.number(),
	/** What recovery fired (looped→salvaged, recovered-narrated-call, …), when any. */
	salvage: z.string().nullable(),
	artifacts: attemptArtifactsSchema.nullable(),
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

/** The full ledger event — a discriminated union on `kind` (extensible: add an event-kind schema to the union). */
export const agentLedgerEventSchema = z.discriminatedUnion("kind", [
	attemptEventSchema,
	transitionEventSchema,
	schedulerEventSchema,
]);
export type AgentLedgerEvent = z.infer<typeof agentLedgerEventSchema>;
export type AgentAttemptEvent = z.infer<typeof attemptEventSchema>;
export type AgentTransitionEvent = z.infer<typeof transitionEventSchema>;
export type AgentSchedulerEvent = z.infer<typeof schedulerEventSchema>;

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
	startedAt?: number | null;
	completedAt?: number | null;
	ttftMs?: number | null;
	tokensPerSec?: number | null;
	toolCalls?: AttemptToolCall[];
	outcome: ModelOutcomeKind;
	qualityScore?: number | null;
	qualityOk?: boolean | null;
	retriesBefore?: number;
	salvage?: string | null;
	artifacts?: AttemptArtifacts | null;
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
		startedAt: input.startedAt ?? null,
		completedAt: input.completedAt ?? null,
		ttftMs: input.ttftMs ?? null,
		tokensPerSec: input.tokensPerSec ?? null,
		toolCalls: input.toolCalls ? input.toolCalls.map((call) => ({ ...call })) : [],
		outcome: input.outcome,
		qualityScore: input.qualityScore ?? null,
		qualityOk: input.qualityOk ?? null,
		retriesBefore: input.retriesBefore ?? 0,
		salvage: input.salvage ?? null,
		artifacts: input.artifacts ? { ...input.artifacts } : null,
	};
}

export interface BuildTransitionEventInput extends LedgerEnvelopeInput {
	from?: string | null;
	to: string;
	reason?: string | null;
	controllerDecision?: string | null;
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

// ─── Projections (the keystone value: the §5.AA profile / §5.AB fitness / §5.Z matrix become queries over this) ───

export function isAttemptEvent(event: AgentLedgerEvent): event is AgentAttemptEvent {
	return event.kind === "attempt";
}
export function isTransitionEvent(event: AgentLedgerEvent): event is AgentTransitionEvent {
	return event.kind === "transition";
}

/** All attempt events, in recorded order (oldest→newest by `recordedAt`, stable). */
export function selectAttempts(events: readonly AgentLedgerEvent[]): AgentAttemptEvent[] {
	return events.filter(isAttemptEvent);
}

/** Attempts for a given canonical model id. */
export function selectAttemptsForModel(events: readonly AgentLedgerEvent[], modelId: string): AgentAttemptEvent[] {
	return selectAttempts(events).filter((event) => event.modelId === modelId);
}

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

/** Every event of one workflow run. */
export function selectEventsForWorkflow(events: readonly AgentLedgerEvent[], workflowId: string): AgentLedgerEvent[] {
	return events.filter((event) => event.workflowId === workflowId);
}

/**
 * The current controller run-state for a workflow — the `to` of its most-recent transition (by `recordedAt`), or null
 * when it never transitioned. This is how the durable scheduler resumes "exactly where it was" without re-asking a model.
 */
export function latestRunState(events: readonly AgentLedgerEvent[], workflowId: string): string | null {
	let latest: AgentTransitionEvent | null = null;
	for (const event of events) {
		if (event.kind !== "transition" || event.workflowId !== workflowId) {
			continue;
		}
		if (latest === null || event.recordedAt >= latest.recordedAt) {
			latest = event;
		}
	}
	return latest?.to ?? null;
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
