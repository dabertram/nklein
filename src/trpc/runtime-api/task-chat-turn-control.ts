import type {
	RuntimeTaskChatAbortRequest,
	RuntimeTaskChatAbortResponse,
	RuntimeTaskChatCancelRequest,
	RuntimeTaskChatCancelResponse,
} from "../../core/api-contract";
import { parseTaskChatAbortRequest, parseTaskChatCancelRequest } from "../../core/api-validation";
import { INTERVENTION_CATEGORY } from "../../core/intervention-observation";
import type { NKleinTaskSessionService } from "../../nklein-agent/nklein-task-session-service";
import { recordSelfObservation } from "../../telemetry/self-observation-sink";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";

interface TaskChatTurnControlDeps {
	getScopedNKleinTaskSessionService: (scope: RuntimeTrpcWorkspaceScope) => Promise<NKleinTaskSessionService>;
}

/**
 * Abort a task's running chat session (the runtime-api `abortTaskChatTurn` procedure handler, extracted
 * from the factory). Returns ok:false when nothing is running. The session-service resolver is the only
 * factory dependency, so the lift is behavior-preserving.
 */
export async function handleAbortTaskChatTurn(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeTaskChatAbortRequest,
	deps: TaskChatTurnControlDeps,
): Promise<RuntimeTaskChatAbortResponse> {
	try {
		const body = parseTaskChatAbortRequest(input);
		const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
		const summary = await nkleinTaskSessionService.abortTaskSession(body.taskId);
		if (!summary) {
			return { ok: false, summary: null, error: "Task chat session is not running." };
		}
		// P20.10 / N18: a TAKEOVER — the user stopped the agent's whole session while retaining the card and its
		// work. An actual abort is the distinct, explicit gesture that abandons an already-started card to Trash.
		// Recorded only when a session was actually running (a no-op click is not an intervention).
		//
		// ⚠️ **`handleCancelTaskChatTurn` below is deliberately NOT instrumented.** Cancelling a turn looks like a
		// sibling of this, but the nudge path performs cancel-then-send — so recording an intervention there would
		// log a takeover for **every nudge**, inflating the metric with normal steering and corrupting the one number
		// P20.10 exists to keep honest. The nudge is already recorded at the send path.
		try {
			recordSelfObservation({
				signal: "custom",
				severity: "warning",
				message: `Operator took over task ${body.taskId} by stopping its running agent session.`,
				taskId: body.taskId,
				metadata: { category: INTERVENTION_CATEGORY, interventionSeverity: "takeover" },
			});
		} catch {
			// Telemetry must never break the takeover the user asked for.
		}
		return { ok: true, summary };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, summary: null, error: message };
	}
}

/**
 * Cancel a task's in-flight chat turn (the runtime-api `cancelTaskChatTurn` procedure handler). Like takeover,
 * but scoped to the current turn rather than the whole session and deliberately not an intervention on its own.
 */
export async function handleCancelTaskChatTurn(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeTaskChatCancelRequest,
	deps: TaskChatTurnControlDeps,
): Promise<RuntimeTaskChatCancelResponse> {
	try {
		const body = parseTaskChatCancelRequest(input);
		const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
		const summary = await nkleinTaskSessionService.cancelTaskTurn(body.taskId);
		if (!summary) {
			return { ok: false, summary: null, error: "Task chat session turn is not running." };
		}
		return { ok: true, summary };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, summary: null, error: message };
	}
}
