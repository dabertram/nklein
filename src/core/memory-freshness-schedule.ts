/**
 * F5.2 (pure scheduler core) — the decision + retention seam between the runtime idle path and the model-free
 * {@link auditMemoryFreshness} pass. Two concerns, both pure so the effectful b-leaf is a thin timer:
 *
 *  1. GATE — {@link runFreshnessAuditIfDue} folds the persisted runtime controls (enabled/paused) and the cadence gate
 *     ({@link shouldRunFreshnessAudit}) over the on-disk notes into a run-or-skip verdict. The audit is read-only and
 *     millisecond-cheap (filesystem only, no model), so unlike the opportunistic model-work pickers it does NOT compete
 *     for the single idle slot — it just runs when due and off-cooldown.
 *  2. SINK — findings + the last-run clock are retained on the agent ledger following the F1.26 pattern used by
 *     `rail-findings.ts`: a `transition` event with a dedicated {@link MEMORY_FRESHNESS_AUDIT_DECISION}, latest wins on
 *     read. {@link readLatestMemoryFreshnessAudit} is the read half — it recovers `lastAuditAt` (the event clock) and
 *     the per-kind summary, so the next gate decision and the operator surface both come from the durable ledger.
 */

import { type AgentLedgerEvent, type AgentTransitionEvent, buildTransitionEvent } from "./agent-attempt-ledger.js";
import {
	type AuditableMemoryNote,
	auditMemoryFreshness,
	type MemoryFreshnessAuditResult,
	type MemoryFreshnessFindingKind,
	shouldRunFreshnessAudit,
} from "./memory-freshness-audit.js";
import {
	classifyMemoryLifecycle,
	DEFAULT_MEMORY_LIFECYCLE_CONFIG,
	type LifecycleAction,
	type MemoryLifecycleConfig,
	type NoteLifecycleRecommendation,
	type NoteLifecycleSignals,
} from "./memory-lifecycle.js";

/** The persisted runtime controls the scheduler folds in (structurally the `RuntimeMemoryFreshnessAudit` config). */
export interface MemoryFreshnessScheduleConfig {
	readonly enabled: boolean;
	readonly paused: boolean;
	readonly cadenceMs: number;
	readonly stalenessThresholdMs: number;
}

export type MemoryFreshnessSkipReason = "disabled" | "paused" | "not_due";

export type MemoryFreshnessRun =
	| { readonly ran: true; readonly result: MemoryFreshnessAuditResult }
	| { readonly ran: false; readonly reason: MemoryFreshnessSkipReason };

export interface RunFreshnessAuditIfDueInput {
	readonly config: MemoryFreshnessScheduleConfig;
	/** Epoch-ms of the last completed audit (from {@link readLatestMemoryFreshnessAudit}), or null if never run. */
	readonly lastAuditAt: number | null;
	readonly notes: readonly AuditableMemoryNote[];
	readonly now: number;
}

/**
 * The full gate: disabled/paused short-circuit BEFORE the cadence check (a paused-but-due audit must not run), then the
 * cadence gate, then the audit itself. Pure — the effectful rail persists {@link buildMemoryFreshnessAuditRetentionEvent}
 * only when `ran` is true.
 */
export function runFreshnessAuditIfDue(input: RunFreshnessAuditIfDueInput): MemoryFreshnessRun {
	if (!input.config.enabled) {
		return { ran: false, reason: "disabled" };
	}
	if (input.config.paused) {
		return { ran: false, reason: "paused" };
	}
	const auditConfig = {
		cadenceMs: input.config.cadenceMs,
		stalenessThresholdMs: input.config.stalenessThresholdMs,
	};
	if (!shouldRunFreshnessAudit(input.lastAuditAt, auditConfig, input.now)) {
		return { ran: false, reason: "not_due" };
	}
	return { ran: true, result: auditMemoryFreshness(input.notes, auditConfig, input.now) };
}

export const MEMORY_FRESHNESS_AUDIT_DECISION = "memory_freshness_audit";
export const MEMORY_FRESHNESS_WORKFLOW_ID = "memory-freshness-audit";
/** Every audit retains under this single task id — the latest event IS the current state (there is one audit per ws). */
export const MEMORY_FRESHNESS_TASK_ID = "memory-freshness";

const FINDING_KINDS: readonly MemoryFreshnessFindingKind[] = ["stale", "orphaned", "broken_link", "duplicate_title"];

/** The durable snapshot the read half recovers from a retention event: when it ran + how many of each finding kind. */
export interface RetainedMemoryFreshnessAudit {
	readonly auditedAt: number;
	readonly notesAudited: number;
	readonly summary: Readonly<Record<MemoryFreshnessFindingKind, number>>;
	readonly totalFindings: number;
}

interface RetentionReasonPayload {
	readonly notesAudited: number;
	readonly summary: Record<MemoryFreshnessFindingKind, number>;
}

/**
 * Retain one completed audit as ledger evidence (F1.26 pattern): a `transition` event under the single
 * {@link MEMORY_FRESHNESS_TASK_ID}, so a later audit supersedes the prior on read. The per-kind summary + notes count
 * ride in `reason` as compact JSON (tiny — four integers); `recordedAt` IS the last-run clock the gate reads back.
 */
export function buildMemoryFreshnessAuditRetentionEvent(input: {
	workspacePathHash: string;
	result: MemoryFreshnessAuditResult;
	recordedAt?: number;
}): AgentTransitionEvent {
	const payload: RetentionReasonPayload = {
		notesAudited: input.result.notesAudited,
		summary: { ...input.result.summary },
	};
	return buildTransitionEvent({
		workflowId: MEMORY_FRESHNESS_WORKFLOW_ID,
		taskId: MEMORY_FRESHNESS_TASK_ID,
		workspacePathHash: input.workspacePathHash,
		from: "memory_evidence",
		to: `memory_freshness_${input.result.findings.length}`,
		reason: JSON.stringify(payload).slice(0, 900),
		controllerDecision: MEMORY_FRESHNESS_AUDIT_DECISION,
		// The audit's own clock IS the run clock — keep them identical so the next cadence gate is exact.
		recordedAt: input.recordedAt ?? input.result.auditedAt,
	});
}

function parseRetentionReason(reason: string | null): RetentionReasonPayload | null {
	if (!reason) {
		return null;
	}
	try {
		const parsed = JSON.parse(reason) as Partial<RetentionReasonPayload>;
		if (!parsed || typeof parsed.notesAudited !== "number" || !parsed.summary) {
			return null;
		}
		const summary = {} as Record<MemoryFreshnessFindingKind, number>;
		for (const kind of FINDING_KINDS) {
			const raw = (parsed.summary as Record<string, unknown>)[kind];
			summary[kind] = typeof raw === "number" ? raw : 0;
		}
		return { notesAudited: parsed.notesAudited, summary };
	} catch {
		return null;
	}
}

/**
 * The read half of the retention pattern: the LATEST retained audit for this workspace, or null if none. `auditedAt`
 * (the event `recordedAt`) is exactly what {@link runFreshnessAuditIfDue} needs as `lastAuditAt` next tick.
 */
export function readLatestMemoryFreshnessAudit(
	events: readonly AgentLedgerEvent[],
): RetainedMemoryFreshnessAudit | null {
	let latest: AgentTransitionEvent | null = null;
	for (const event of events) {
		if (event.kind !== "transition" || event.controllerDecision !== MEMORY_FRESHNESS_AUDIT_DECISION) {
			continue;
		}
		if (!latest || event.recordedAt >= latest.recordedAt) {
			latest = event;
		}
	}
	if (!latest) {
		return null;
	}
	const payload = parseRetentionReason(latest.reason);
	const summary = payload?.summary ?? { stale: 0, orphaned: 0, broken_link: 0, duplicate_title: 0 };
	const totalFindings = FINDING_KINDS.reduce((sum, kind) => sum + summary[kind], 0);
	return {
		auditedAt: latest.recordedAt,
		notesAudited: payload?.notesAudited ?? 0,
		summary,
		totalFindings,
	};
}

/**
 * The COMBINED F5.2 memory-audit pass (pure) — runs the cadence-gated freshness audit and, when it runs, ALSO classifies
 * the knowledge-lifecycle recommendations (opencode-swarm port) over the same notes. This gives {@link
 * classifyMemoryLifecycle} its home: freshness FLAGS hygiene issues, lifecycle RECOMMENDS promote/retire/merge actions —
 * one idle pass, both surfaced. Lifecycle degrades to recency+centrality when no retrieval telemetry is supplied.
 */
export interface MemoryAuditPassResult {
	readonly freshness: MemoryFreshnessRun;
	/** Lifecycle recommendations when the audit ran; null when it was skipped (disabled/paused/not-due). */
	readonly lifecycle: readonly NoteLifecycleRecommendation[] | null;
	/** Count per lifecycle action (only the non-`keep` actions are operator-actionable), null when skipped. */
	readonly lifecycleSummary: Readonly<Record<LifecycleAction, number>> | null;
}

export interface RunMemoryAuditPassInput extends RunFreshnessAuditIfDueInput {
	readonly lifecycleConfig?: MemoryLifecycleConfig;
	/** Per-note retrieval telemetry keyed by note id; absent ⇒ lifecycle scores on recency + centrality only. */
	readonly retrievalSignals?: Readonly<Record<string, NoteLifecycleSignals>>;
}

export function runMemoryAuditPass(input: RunMemoryAuditPassInput): MemoryAuditPassResult {
	const freshness = runFreshnessAuditIfDue(input);
	if (!freshness.ran) {
		return { freshness, lifecycle: null, lifecycleSummary: null };
	}
	const lifecycle = classifyMemoryLifecycle(
		input.notes,
		input.retrievalSignals ?? {},
		input.lifecycleConfig ?? DEFAULT_MEMORY_LIFECYCLE_CONFIG,
		input.now,
	);
	const lifecycleSummary: Record<LifecycleAction, number> = { promote: 0, retire: 0, merge: 0, keep: 0 };
	for (const recommendation of lifecycle) {
		lifecycleSummary[recommendation.action] += 1;
	}
	return { freshness, lifecycle, lifecycleSummary };
}
