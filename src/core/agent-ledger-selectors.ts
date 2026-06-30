// Pure queries over a flat agent-attempt-ledger event stream (extracted from agent-attempt-ledger.ts, §5.U):
// the event-kind type guards plus the attempt/workflow selectors the projections and the durable scheduler read.
// Type-only import of the event types (defined alongside their zod schemas in agent-attempt-ledger) keeps this
// runtime-cycle-free; the ledger module re-exports these so its existing importers are unchanged.
import type { AgentAttemptEvent, AgentLedgerEvent, AgentTransitionEvent } from "./agent-attempt-ledger";

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
