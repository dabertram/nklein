/**
 * Project a {@link ProcessTrajectory} from the agent attempt ledger (pure) — the input adapter that lets the record-only
 * PRM watchdog run {@link detectProcessRemediation} over a card's real history. Each `attempt` event for the task
 * becomes one trajectory step: the acting role, whether it made progress (a `success` outcome), and the union of file
 * paths its tool calls touched (now that {@link AttemptToolCall.filePaths} is captured — the context-thrash signal).
 *
 * Plan counts (for expansion-drift) come from a source the ledger attempts don't carry, so they're an optional caller
 * input; absent ⇒ initial === current (no drift asserted). Pure + deterministic.
 */

import type { AgentAttemptEvent, AgentLedgerEvent } from "./agent-attempt-ledger.js";
import type { ProcessTrajectory, TrajectoryStep } from "./process-remediation.js";

function isAttemptForTask(event: AgentLedgerEvent, taskId: string): event is AgentAttemptEvent {
	return event.kind === "attempt" && event.taskId === taskId;
}

export function buildProcessTrajectoryFromLedger(
	events: readonly AgentLedgerEvent[],
	taskId: string,
	planCounts?: { initial: number; current: number },
): ProcessTrajectory {
	const steps: TrajectoryStep[] = [];
	for (const event of events) {
		if (!isAttemptForTask(event, taskId)) {
			continue;
		}
		const filesRequested = new Set<string>();
		for (const call of event.toolCalls) {
			for (const filePath of call.filePaths ?? []) {
				filesRequested.add(filePath);
			}
		}
		steps.push({
			agent: event.role ?? "unknown",
			madeProgress: event.outcome === "success",
			filesRequested: [...filesRequested],
		});
	}
	return {
		steps,
		initialPlanTaskCount: planCounts?.initial ?? 0,
		currentPlanTaskCount: planCounts?.current ?? planCounts?.initial ?? 0,
	};
}
