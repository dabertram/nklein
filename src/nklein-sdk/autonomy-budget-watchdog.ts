/**
 * Autonomy-budget watchdog collaborator (todo §5.X Phase 1 M3).
 *
 * Owns all per-task state and decision logic for the three autonomous-run guardrails that fire
 * at every {@link https://developer.mozilla.org/en-US/docs/Web | turn checkpoint}:
 *
 *  1. **Operator pause** — the board or card was paused; park the task immediately so it stops
 *     running.
 *
 *  2. **Max autonomous turns** — the task has consumed its turn budget; park for review.
 *
 *  3. **Repeated no-diff checkpoints** — consecutive checkpoints produced the same commit hash
 *     (the agent is spinning without making progress); park for review after N repeats.
 *
 *  4. **Max autonomous wall time** — the task has been running longer than the wall-time limit;
 *     park for review.
 *
 * The actual I/O side effects (aborting the SDK session, emitting system messages, updating the
 * summary state) stay in the session service and are injected via
 * {@link AutonomyBudgetWatchdogCallbacks}. Only per-task state tracking and the park/no-park
 * decision live here.
 *
 * Call sites in the session service:
 *  - `watchdog.check(taskId, checkpoint, entry)` — from `enforceAutonomyBudgets`; returns the
 *    decision (park type + args), or `null` to continue.
 *  - `watchdog.resetTask(taskId)` — on task start/restart/stop/abort/clear (clears per-task
 *    no-diff state).
 *  - `watchdog.dispose()` — on service dispose (clears the Map).
 */

import type {
	RuntimeSwarmGuardrails,
	RuntimeTaskSessionSummary,
	RuntimeTaskTurnCheckpoint,
} from "../core/api-contract";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import type { NKleinTaskSessionEntry } from "./nklein-session-state";
import { now } from "./nklein-session-state";

// ---------------------------------------------------------------------------
// Internal state shape
// ---------------------------------------------------------------------------

interface NKleinTaskNoDiffState {
	commit: string;
	count: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an elapsed duration in milliseconds as a human-readable string.
 * Mirrors `formatWallTimeDuration` from the original session service.
 */
export function formatWallTimeDuration(durationMs: number): string {
	const totalMinutes = Math.max(1, Math.round(durationMs / 60_000));
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours === 0) {
		return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
	}
	if (minutes === 0) {
		return `${hours} hour${hours === 1 ? "" : "s"}`;
	}
	return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Callbacks interface
// ---------------------------------------------------------------------------

/**
 * Callbacks the session service provides to let the watchdog perform the two park I/O side
 * effects without importing or knowing about the full service.
 */
export interface AutonomyBudgetWatchdogCallbacks {
	/**
	 * The live swarm guardrail limits. Read fresh each check so a live config update
	 * (via `setSwarmGuardrails`) takes effect immediately.
	 */
	getSwarmGuardrails(): RuntimeSwarmGuardrails;
	/**
	 * True when the task (or the entire board) is currently paused by the operator.
	 */
	isTaskPaused(taskId: string): boolean;
	/**
	 * Park the task as an operator-initiated pause (reversible; does NOT set `reviewReason`).
	 * Returns the updated (paused) summary.
	 */
	parkTaskForPause(input: {
		taskId: string;
		entry: NKleinTaskSessionEntry;
		message: string;
		metadata: Record<string, unknown>;
	}): RuntimeTaskSessionSummary;
	/**
	 * Park the task for autonomy-budget exhaustion (sets `reviewReason: "attention"`).
	 * Returns the updated (parked) summary.
	 */
	parkTaskForAutonomyBudget(input: {
		taskId: string;
		entry: NKleinTaskSessionEntry;
		message: string;
		metadata: Record<string, unknown>;
	}): RuntimeTaskSessionSummary;
}

// ---------------------------------------------------------------------------
// Collaborator class
// ---------------------------------------------------------------------------

/**
 * Collaborator that owns the per-task no-diff checkpoint state Map and all associated
 * autonomous-run guardrail decision logic. Constructed once by the session service and held
 * for its lifetime.
 */
export class AutonomyBudgetWatchdog {
	private readonly noDiffCheckpointByTaskId = new Map<string, NKleinTaskNoDiffState>();

	constructor(private readonly callbacks: AutonomyBudgetWatchdogCallbacks) {}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	/**
	 * Run all autonomy-budget guardrails for `taskId` at `checkpoint`. Returns the parked
	 * summary if any guardrail trips, or `null` to let the task continue running.
	 *
	 * Mirrors `enforceAutonomyBudgets(taskId, checkpoint)` from the original session service.
	 */
	check(
		taskId: string,
		checkpoint: RuntimeTaskTurnCheckpoint,
		entry: NKleinTaskSessionEntry,
	): RuntimeTaskSessionSummary | null {
		if (isHomeAgentSessionId(taskId)) {
			return null;
		}
		if (entry.summary.reviewReason === "attention") {
			return null;
		}
		const guardrails = this.callbacks.getSwarmGuardrails();

		// 1. Operator pause
		if (this.callbacks.isTaskPaused(taskId)) {
			return this.callbacks.parkTaskForPause({
				taskId,
				entry,
				message: "Paused — will resume when the board/card is resumed.",
				metadata: {
					guardrail: "operator_pause",
					turn: checkpoint.turn,
					checkpointRef: checkpoint.ref,
					checkpointCommit: checkpoint.commit,
				},
			});
		}

		// 2. Max autonomous turns
		if (checkpoint.turn >= guardrails.maxAutonomousTurnsPerTask) {
			return this.callbacks.parkTaskForAutonomyBudget({
				taskId,
				entry,
				message: `!Klein paused this task after ${checkpoint.turn} autonomous turns so the swarm cannot run indefinitely. Review progress, then send a new instruction to continue.`,
				metadata: {
					guardrail: "max_autonomous_turns",
					turn: checkpoint.turn,
					limit: guardrails.maxAutonomousTurnsPerTask,
					checkpointRef: checkpoint.ref,
					checkpointCommit: checkpoint.commit,
				},
			});
		}

		// 3. Repeated no-diff checkpoints
		const noDiffState = this.recordNoDiffCheckpoint(taskId, checkpoint);
		if (noDiffState.count >= guardrails.maxRepeatedNoDiffCheckpoints) {
			return this.callbacks.parkTaskForAutonomyBudget({
				taskId,
				entry,
				message: `!Klein paused this task after ${noDiffState.count} consecutive checkpoints produced no new diff commit. Review progress, then send a new instruction to continue.`,
				metadata: {
					guardrail: "repeated_no_diff_checkpoints",
					count: noDiffState.count,
					limit: guardrails.maxRepeatedNoDiffCheckpoints,
					turn: checkpoint.turn,
					checkpointRef: checkpoint.ref,
					checkpointCommit: checkpoint.commit,
				},
			});
		}

		// 4. Max autonomous wall time
		const startedAt = entry.summary.startedAt;
		const elapsedMs =
			typeof startedAt === "number" && Number.isFinite(startedAt) && startedAt > 0 ? now() - startedAt : null;
		if (elapsedMs !== null && elapsedMs >= guardrails.maxAutonomousWallTimeMs) {
			return this.callbacks.parkTaskForAutonomyBudget({
				taskId,
				entry,
				message: `!Klein paused this task after ${formatWallTimeDuration(elapsedMs)} of autonomous wall time so the swarm cannot run indefinitely. Review progress, then send a new instruction to continue.`,
				metadata: {
					guardrail: "max_autonomous_wall_time",
					elapsedMs,
					limitMs: guardrails.maxAutonomousWallTimeMs,
					turn: checkpoint.turn,
					checkpointRef: checkpoint.ref,
					checkpointCommit: checkpoint.commit,
				},
			});
		}

		return null;
	}

	/**
	 * Reset all watchdog state for a single task. Called on task start, restart, stop, abort,
	 * and clear so stale no-diff counts do not carry over to a fresh session.
	 */
	resetTask(taskId: string): void {
		this.noDiffCheckpointByTaskId.delete(taskId);
	}

	/**
	 * Dispose all watchdog state. Called once when the session service is torn down.
	 */
	dispose(): void {
		this.noDiffCheckpointByTaskId.clear();
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	private recordNoDiffCheckpoint(taskId: string, checkpoint: RuntimeTaskTurnCheckpoint): NKleinTaskNoDiffState {
		const commit = checkpoint.commit.trim();
		if (!commit) {
			this.noDiffCheckpointByTaskId.delete(taskId);
			return { commit: "", count: 0 };
		}
		const previous = this.noDiffCheckpointByTaskId.get(taskId);
		const nextState = previous?.commit === commit ? { commit, count: previous.count + 1 } : { commit, count: 1 };
		this.noDiffCheckpointByTaskId.set(taskId, nextState);
		return nextState;
	}
}
