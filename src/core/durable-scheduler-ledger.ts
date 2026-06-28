/**
 * The durable-scheduler ⇄ Agent Attempt Ledger adapter (todo §5.AF; the C3 boot-replay seam) — PURE.
 *
 * The durable scheduler ({@link ./durable-scheduler}) is the pure brain; its persisted log is a stream of
 * {@link DurableSchedulerLogEntry} (scheduler-decided actions + worker completions). To make a multi-card run survive a
 * runtime restart, that log must live in the ONE durable evidence stream — the §5.AF ledger — so a fresh process replays
 * it and resumes "exactly where it was". This module is the lossless bridge between the two representations, kept pure so
 * the mapping is testable + replay-deterministic before any runtime wiring (mirrors the substrate-first pattern of
 * `durable-scheduler` / `agent-attempt-ledger`).
 *
 * Design: the scheduler's persistence is **self-contained within the `scheduler` event family**. A boot-replay therefore
 * reads exactly one family and folds it — no need to disambiguate which rich `attempt` rung was "the completion" (an
 * attempt may be an internal §5.AA retry rung the worker did *while still holding the lease*; only the worker's final
 * report concludes the lease). The worker's terminal report is the `completed` scheduler event (outcome in `detail`); the
 * rich per-invocation evidence still lives in the `attempt` family alongside it (two events at different grains — the
 * lease lifecycle vs. the model invocation — not a duplicated source of truth).
 *
 * Action → scheduler event:
 *   - `lease`   → `lease_acquired` (workerId; `detail` = expiresAt; `leaseId` = workerId for traceability)
 *   - `reclaim` → `reclaimed`      (`detail` = reason, "lease_expired")
 *   - `unblock` → `dependency_unblocked`
 *   - `fail`    → `cancelled`      (`detail` = reason, "max_attempts" | "dependency_failed")
 *   - completed → `completed`      (`detail` = "succeeded" | "failed")
 * The scheduled entry's `now` round-trips through the ledger envelope's `recordedAt` (which is why `recordedAt` is the
 * scheduler clock). Unrecognized scheduler events (queued/dequeued/heartbeat/lease_expired/retry_backoff — informational,
 * not part of the durable-log state model) are skipped on read.
 */

import {
	type AgentLedgerEvent,
	type AgentSchedulerEvent,
	buildSchedulerEvent,
	type SchedulerEventName,
} from "./agent-attempt-ledger";
import type { DurableSchedulerAction, DurableSchedulerLogEntry } from "./durable-scheduler";

/** Envelope fields the runtime supplies when persisting a durable-log entry as a ledger event. */
export interface DurableLedgerEnvelope {
	/** The durable run/workflow handle (groups all of a run's scheduler events). */
	workflowId: string;
	/** A hash of the workspace path (never the path itself — #2). */
	workspacePathHash: string;
	role?: string | null;
	/** Overrides the recorded clock; defaults to the entry's `now` (scheduled) so a replay reconstructs reclaim backoff. */
	recordedAt?: number;
	/** Stable id for the event; defaults to a random uuid (pass explicitly in tests for determinism). */
	eventId?: string;
}

/** The task id a durable-log entry concerns (the job id is the card/task id). */
function entryTaskId(entry: DurableSchedulerLogEntry): string {
	return entry.kind === "completed" ? entry.jobId : entry.action.jobId;
}

function actionToSchedulerFields(action: DurableSchedulerAction): {
	event: SchedulerEventName;
	workerId: string | null;
	leaseId: string | null;
	detail: string | null;
} {
	switch (action.type) {
		case "lease":
			return {
				event: "lease_acquired",
				workerId: action.workerId,
				leaseId: action.workerId,
				detail: String(action.expiresAt),
			};
		case "reclaim":
			return { event: "reclaimed", workerId: null, leaseId: null, detail: action.reason };
		case "unblock":
			return { event: "dependency_unblocked", workerId: null, leaseId: null, detail: null };
		case "fail":
			return { event: "cancelled", workerId: null, leaseId: null, detail: action.reason };
	}
}

/**
 * Map one durable-scheduler log entry to a validated `scheduler` ledger event (the WRITE side — the runtime appends this
 * as it applies each decision/completion). The scheduled clock (`now`) becomes `recordedAt` unless overridden.
 */
export function durableLogEntryToSchedulerEvent(
	entry: DurableSchedulerLogEntry,
	envelope: DurableLedgerEnvelope,
): AgentSchedulerEvent {
	const base = {
		workflowId: envelope.workflowId,
		taskId: entryTaskId(entry),
		workspacePathHash: envelope.workspacePathHash,
		role: envelope.role ?? null,
		...(envelope.eventId !== undefined ? { eventId: envelope.eventId } : {}),
	};
	if (entry.kind === "completed") {
		return buildSchedulerEvent({
			...base,
			recordedAt: envelope.recordedAt ?? Date.now(),
			event: "completed",
			detail: entry.outcome,
		});
	}
	const fields = actionToSchedulerFields(entry.action);
	return buildSchedulerEvent({
		...base,
		recordedAt: envelope.recordedAt ?? entry.now,
		event: fields.event,
		workerId: fields.workerId,
		leaseId: fields.leaseId,
		detail: fields.detail,
	});
}

function isSchedulerEvent(event: AgentLedgerEvent): event is AgentSchedulerEvent {
	return event.kind === "scheduler";
}

type DurableFailReason = Extract<DurableSchedulerAction, { type: "fail" }>["reason"];
const FAIL_REASONS = new Set<DurableFailReason>(["max_attempts", "dependency_failed"]);

/** Map one `scheduler` ledger event back to a durable-log entry, or `null` if it isn't part of the durable-log model. */
function schedulerEventToDurableLogEntry(event: AgentSchedulerEvent): DurableSchedulerLogEntry | null {
	const jobId = event.taskId;
	switch (event.event) {
		case "lease_acquired": {
			const expiresAt = Number(event.detail);
			if (!Number.isFinite(expiresAt) || event.workerId === null) {
				return null;
			}
			return {
				kind: "scheduled",
				now: event.recordedAt,
				action: { type: "lease", jobId, workerId: event.workerId, expiresAt },
			};
		}
		case "reclaimed":
			return {
				kind: "scheduled",
				now: event.recordedAt,
				action: { type: "reclaim", jobId, reason: "lease_expired" },
			};
		case "dependency_unblocked":
			return { kind: "scheduled", now: event.recordedAt, action: { type: "unblock", jobId } };
		case "cancelled": {
			const reason: DurableFailReason = FAIL_REASONS.has(event.detail as DurableFailReason)
				? (event.detail as DurableFailReason)
				: "max_attempts";
			return { kind: "scheduled", now: event.recordedAt, action: { type: "fail", jobId, reason } };
		}
		case "completed": {
			if (event.detail !== "succeeded" && event.detail !== "failed") {
				return null;
			}
			return { kind: "completed", jobId, outcome: event.detail };
		}
		default:
			// queued/dequeued/heartbeat/lease_expired/retry_backoff — informational; not part of the durable-log state model.
			return null;
	}
}

/**
 * Read a durable-scheduler log back out of the ledger (the boot-replay READ side): keep the `scheduler` family — scoped
 * to one run via `workflowId` (a real ledger holds many runs) — order by `recordedAt` (stable), and map each event to its
 * {@link DurableSchedulerLogEntry}. Feed the result straight to {@link replayDurableJobs} over the run's initial job graph
 * to resume exactly. Pure + deterministic.
 */
export function readDurableSchedulerLog(
	events: readonly AgentLedgerEvent[],
	options?: { workflowId?: string },
): DurableSchedulerLogEntry[] {
	const workflowId = options?.workflowId;
	return events
		.filter(isSchedulerEvent)
		.filter((event) => workflowId === undefined || event.workflowId === workflowId)
		.map((event, index) => ({ event, index }))
		.sort((a, b) => a.event.recordedAt - b.event.recordedAt || a.index - b.index)
		.map(({ event }) => schedulerEventToDurableLogEntry(event))
		.filter((entry): entry is DurableSchedulerLogEntry => entry !== null);
}
