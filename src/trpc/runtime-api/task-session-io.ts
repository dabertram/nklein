import type {
	RuntimeTaskSessionInputRequest,
	RuntimeTaskSessionInputResponse,
	RuntimeTaskSessionStopRequest,
	RuntimeTaskSessionStopResponse,
} from "../../core/api-contract";
import { parseTaskSessionInputRequest, parseTaskSessionStopRequest } from "../../core/api-validation";
import { setCardPaused } from "../../core/card-pause";
import { reconcileStartedTaskBoardLane } from "../../core/task-board-lane-reconcile";
import type { NKleinTaskSessionService } from "../../nklein-agent/nklein-task-session-service";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";
import { withTaskPausedState } from "../runtime-task-paused-state";

interface TaskSessionIoDeps {
	getScopedNKleinTaskSessionService: (scope: RuntimeTrpcWorkspaceScope) => Promise<NKleinTaskSessionService>;
}

/**
 * Stop a task's session and clear its paused flag (the runtime-api `stopTaskSession` procedure handler,
 * extracted from the factory). Returns the paused-state-projected summary; ok reflects whether a session
 * was actually stopped. The session-service resolver is the only factory dependency.
 */
export async function handleStopTaskSession(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeTaskSessionStopRequest,
	deps: TaskSessionIoDeps,
): Promise<RuntimeTaskSessionStopResponse> {
	try {
		const body = parseTaskSessionStopRequest(input);
		const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
		const nkleinSummary = await nkleinTaskSessionService.stopTaskSession(body.taskId);
		const pausedTaskIds = await setCardPaused({
			workspacePath: workspaceScope.workspacePath,
			taskId: body.taskId,
			paused: false,
		});
		// Terminal/CLI agents are disabled under the local-only lockdown (§5.A); only NKlein sessions exist.
		return {
			ok: Boolean(nkleinSummary),
			summary: withTaskPausedState(nkleinSummary, pausedTaskIds),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, summary: null, error: message };
	}
}

/**
 * Send input to a running task session (the runtime-api `sendTaskSessionInput` procedure handler).
 * Appends a newline when requested, then reconciles the board lane so a resumed/continued task shows as
 * running. Returns ok:false when no session is running.
 */
export async function handleSendTaskSessionInput(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeTaskSessionInputRequest,
	deps: TaskSessionIoDeps,
): Promise<RuntimeTaskSessionInputResponse> {
	try {
		const body = parseTaskSessionInputRequest(input);
		const payloadText = body.appendNewline ? `${body.text}\n` : body.text;
		const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
		const nkleinSummary = await nkleinTaskSessionService.sendTaskSessionInput(body.taskId, payloadText);
		// Terminal/CLI agents are disabled under the local-only lockdown (§5.A); only NKlein sessions exist.
		if (!nkleinSummary) {
			return { ok: false, summary: null, error: "Task session is not running." };
		}
		await reconcileStartedTaskBoardLane({ workspacePath: workspaceScope.workspacePath, summary: nkleinSummary });
		return { ok: true, summary: nkleinSummary };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, summary: null, error: message };
	}
}
