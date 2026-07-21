import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { isSpeculativeMirrorTaskId } from "../core/synthetic-task-id";

/** A started delivery session waiting at admission is queued work, even though it is absent from taskStartQueue. */
export function hasDeliverySessionWaitingForModelTurn(
	summaries: readonly Pick<RuntimeTaskSessionSummary, "latestHookActivity" | "state" | "taskId">[],
): boolean {
	return summaries.some(
		(summary) =>
			summary.state === "running" &&
			!isSpeculativeMirrorTaskId(summary.taskId) &&
			summary.latestHookActivity?.hookEventName === "model_turn_admission_wait",
	);
}

export interface SpeculativeAttemptController {
	cancelSpeculativeMirror(primaryTaskId: string): Promise<void>;
	stopTaskSession(taskId: string, options?: { abortActiveTurn?: boolean }): Promise<unknown>;
}

/** Cancel attempt-owned speculation before stopping the primary, without letting cancellation failure skip the stop. */
export async function stopPrimaryAttemptForRedrive(
	controller: SpeculativeAttemptController,
	taskId: string,
): Promise<void> {
	try {
		await controller.cancelSpeculativeMirror(taskId);
	} finally {
		// A model-switch redrive must terminate the provider request, not merely stop the SDK session record. A graceful
		// stop can return while LM Studio is still processing the abandoned prompt, letting the replacement exceed cap 1.
		await controller.stopTaskSession(taskId, { abortActiveTurn: true });
	}
}
