import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import type { RuntimeTaskTurnCheckpoint } from "../core/task-session-api-contract";
import type { SelfObservationEventInput } from "../telemetry/self-observation-sink";
import {
	clearActiveTurnState,
	createMessage,
	type NKleinTaskMessage,
	type NKleinTaskSessionEntry,
	now,
	updateSummary,
} from "./nklein-session-state";

/**
 * §5.U — the task pause/park orchestration extracted from `InMemoryNKleinTaskSessionService` as a bounded collaborator.
 * It owns the shared park teardown (stop timers, reset the per-task guards, abort, record, emit a system message) and the
 * two terminal shapes — operator PAUSE (`state: paused`, reversible) vs autonomy-budget PARK (`state: awaiting_review`,
 * `reviewReason: attention`). Everything it touches (message repo, emit pipeline, timeouts, guards, pause controller,
 * session runtime, observation sink) is supplied via {@link ParkControllerDeps}, so the concern is self-contained.
 */
export interface ParkInput {
	taskId: string;
	entry: NKleinTaskSessionEntry;
	message: string;
	metadata: Record<string, unknown>;
}

export interface ParkControllerDeps {
	getTaskEntry(taskId: string): NKleinTaskSessionEntry | null | undefined;
	listSummaries(): RuntimeTaskSessionSummary[];
	emitSummary(summary: RuntimeTaskSessionSummary): void;
	emitMessage(taskId: string, message: NKleinTaskMessage): void;
	clearTaskTimeouts(taskId: string): void;
	checkAutonomyBudget(
		taskId: string,
		checkpoint: RuntimeTaskTurnCheckpoint,
		entry: NKleinTaskSessionEntry,
	): RuntimeTaskSessionSummary | null;
	resetAutonomyBudget(taskId: string): void;
	resetRepeatedToolCallGuard(taskId: string): void;
	markTaskParked(taskId: string): void;
	abortTaskSession(taskId: string): Promise<void>;
	recordObservation(event: SelfObservationEventInput & { taskId: string }): void;
}

export interface ParkController {
	/** Park every currently-running/queued task (or one, when `taskId` is given) as an operator pause. */
	parkActiveTasksForOperatorPause(taskId?: string): void;
	/** Run the autonomy-budget watchdog for a checkpoint; returns a guarded (parked) summary or null. */
	enforceAutonomyBudgets(taskId: string, checkpoint: RuntimeTaskTurnCheckpoint): RuntimeTaskSessionSummary | null;
	/** Park a task as a reversible operator pause; returns the paused summary. */
	parkTaskForPause(input: ParkInput): RuntimeTaskSessionSummary;
	/** Park a task for autonomy-budget exhaustion (awaiting_review / attention); returns the parked summary. */
	parkTaskForAutonomyBudget(input: ParkInput): RuntimeTaskSessionSummary;
}

export function createParkController(deps: ParkControllerDeps): ParkController {
	/** Shared park teardown: stop the task's timers and reset its per-task guards (before the abort). */
	function resetGuardsForPark(taskId: string): void {
		deps.clearTaskTimeouts(taskId);
		deps.resetAutonomyBudget(taskId);
		deps.resetRepeatedToolCallGuard(taskId);
	}

	/** Append a park system message to the task transcript, emit it, and clear the active-turn state. */
	function pushParkSystemMessage(taskId: string, entry: NKleinTaskSessionEntry, message: string): void {
		const systemMessage = createMessage(taskId, "system", message);
		entry.messages.push(systemMessage);
		deps.emitMessage(taskId, systemMessage);
		clearActiveTurnState(entry);
	}

	function parkTaskForPause(input: ParkInput): RuntimeTaskSessionSummary {
		resetGuardsForPark(input.taskId);
		deps.markTaskParked(input.taskId);
		void deps.abortTaskSession(input.taskId).catch(() => undefined);
		deps.recordObservation({
			signal: "custom",
			severity: "info",
			message: input.message,
			taskId: input.taskId,
			metadata: input.metadata,
		});
		pushParkSystemMessage(input.taskId, input.entry, input.message);
		return updateSummary(input.entry, {
			state: "paused",
			reviewReason: null,
			lastOutputAt: now(),
			lastHookAt: now(),
			warningMessage: null,
			latestHookActivity: {
				activityText: input.message,
				toolName: null,
				toolInputSummary: null,
				finalMessage: input.message,
				hookEventName: "operator_pause",
				notificationType: null,
				source: "kanban",
			},
		});
	}

	function parkTaskForAutonomyBudget(input: ParkInput): RuntimeTaskSessionSummary {
		resetGuardsForPark(input.taskId);
		void deps.abortTaskSession(input.taskId).catch(() => undefined);
		deps.recordObservation({
			signal: "budget_wall",
			severity: "warning",
			message: input.message,
			taskId: input.taskId,
			metadata: input.metadata,
		});
		pushParkSystemMessage(input.taskId, input.entry, input.message);
		return updateSummary(input.entry, {
			state: "awaiting_review",
			reviewReason: "attention",
			lastOutputAt: now(),
			lastHookAt: now(),
			warningMessage: input.message,
			latestHookActivity: {
				activityText: input.message,
				toolName: null,
				toolInputSummary: null,
				finalMessage: input.message,
				hookEventName: "guardrail",
				notificationType: "warning",
				source: "kanban",
			},
		});
	}

	return {
		parkActiveTasksForOperatorPause(taskId) {
			const summaries = taskId ? [deps.getTaskEntry(taskId)?.summary].filter(Boolean) : deps.listSummaries();
			for (const summary of summaries) {
				if (!summary || (summary.state !== "running" && summary.state !== "queued")) {
					continue;
				}
				const entry = deps.getTaskEntry(summary.taskId);
				if (!entry) {
					continue;
				}
				deps.emitSummary(
					parkTaskForPause({
						taskId: summary.taskId,
						entry,
						message: "Paused — will resume when the board/card is resumed.",
						metadata: {
							guardrail: "operator_pause",
							source: taskId ? "card_pause" : "board_pause",
						},
					}),
				);
			}
		},
		enforceAutonomyBudgets(taskId, checkpoint) {
			const entry = deps.getTaskEntry(taskId);
			if (!entry) {
				return null;
			}
			return deps.checkAutonomyBudget(taskId, checkpoint, entry);
		},
		parkTaskForPause,
		parkTaskForAutonomyBudget,
	};
}
