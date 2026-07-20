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
		// P20.10 / N18: an ABORT — the user stopped the whole session. The strongest negative signal in the
		// intervention taxonomy, and recorded only when a session was actually running (a no-op abort is not an
		// intervention, it is a click on a dead button).
		//
		// ⚠️ **`handleCancelTaskChatTurn` below is deliberately NOT instrumented.** Cancelling a turn looks like a
		// sibling of this, but the nudge path performs cancel-then-send — so recording an intervention there would
		// log an abort for **every nudge**, inflating the metric with normal steering and corrupting the one number
		// P20.10 exists to keep honest. The nudge is already recorded at the send path.
		try {
			recordSelfObservation({
				signal: "custom",
				severity: "warning",
				message: `Operator aborted the running session on ${body.taskId}.`,
				taskId: body.taskId,
				metadata: { category: INTERVENTION_CATEGORY, interventionSeverity: "abort" },
			});
		} catch {
			// Telemetry must never break the abort a user asked for.
		}
		return { ok: true, summary };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, summary: null, error: message };
	}
}

/**
 * Cancel a task's in-flight chat turn (the runtime-api `cancelTaskChatTurn` procedure handler). Like
 * abort but scoped to the current turn rather than the whole session.
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
