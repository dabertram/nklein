import type { TaskRunTimeoutSource } from "../state/task-run-summary-store";

export interface ConsumedPendingTimeout {
	reason: string | null;
	source: TaskRunTimeoutSource;
}

/**
 * Per-task "pending timeout" details, extracted from InMemoryNKleinTaskSessionService.
 *
 * When a stream/tool/conversation timeout fires, the handler stashes a human-readable reason and
 * the configured timeout source here; the terminal-run recorder later consumes (reads-and-clears)
 * them so the run summary can attribute *why* and *from which config layer* the task timed out.
 *
 * Behavior-preserving extraction: {@link record} mirrors the two inline `.set()` calls and
 * {@link consume} mirrors the get-then-delete pair. Entries are transient between a firing timeout
 * and the terminal record; an unconsumed entry is dropped only when the task is consumed — matching
 * the prior behavior (these maps were never swept on dispose/clear either).
 */
export class TaskPendingTimeoutStore {
	private readonly reasonByTaskId = new Map<string, string>();
	private readonly sourceByTaskId = new Map<string, TaskRunTimeoutSource>();

	/** Stashes the reason+source captured when a timeout fires, to be read later by {@link consume}. */
	record(taskId: string, reason: string, source: TaskRunTimeoutSource): void {
		this.reasonByTaskId.set(taskId, reason);
		this.sourceByTaskId.set(taskId, source);
	}

	/** Reads and clears the stashed reason+source for the task (absent entries read as null). */
	consume(taskId: string): ConsumedPendingTimeout {
		const reason = this.reasonByTaskId.get(taskId) ?? null;
		this.reasonByTaskId.delete(taskId);
		const source = this.sourceByTaskId.get(taskId) ?? null;
		this.sourceByTaskId.delete(taskId);
		return { reason, source };
	}
}
