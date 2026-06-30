import type {
	RuntimeTaskChatAbortRequest,
	RuntimeTaskChatAbortResponse,
	RuntimeTaskChatCancelRequest,
	RuntimeTaskChatCancelResponse,
} from "../../core/api-contract";
import { parseTaskChatAbortRequest, parseTaskChatCancelRequest } from "../../core/api-validation";
import type { NKleinTaskSessionService } from "../../nklein-agent/nklein-task-session-service";
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
