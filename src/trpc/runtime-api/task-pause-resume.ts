import type { RuntimeTaskPauseRequest, RuntimeTaskPauseResponse } from "../../core/api-contract";
import { parseTaskPauseRequest } from "../../core/api-validation";
import { readPausedTasks, setCardPaused } from "../../core/card-pause";
import type { NKleinTaskSessionService } from "../../nklein-agent/nklein-task-session-service";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";
import { withTaskPausedState } from "../runtime-task-paused-state";

interface TaskPauseResumeDeps {
	getScopedNKleinTaskSessionService: (scope: RuntimeTrpcWorkspaceScope) => Promise<NKleinTaskSessionService>;
	getLoadedScopedNKleinTaskSessionService?: (scope: RuntimeTrpcWorkspaceScope) => NKleinTaskSessionService | null;
}

/**
 * Pause a task (the runtime-api `pauseTask` procedure handler, extracted from the factory): mark the
 * card paused on disk, tell the loaded session service (if any) to pause, and return the projected
 * summary + sorted paused-id set. On failure, returns ok:false with the current paused set.
 */
export async function handlePauseTask(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeTaskPauseRequest,
	deps: TaskPauseResumeDeps,
): Promise<RuntimeTaskPauseResponse> {
	try {
		const body = parseTaskPauseRequest(input);
		const pausedTaskIds = await setCardPaused({
			workspacePath: workspaceScope.workspacePath,
			taskId: body.taskId,
			paused: true,
		});
		const nkleinTaskSessionService = deps.getLoadedScopedNKleinTaskSessionService?.(workspaceScope) ?? null;
		nkleinTaskSessionService?.setCardPaused(body.taskId, true);
		const summary = withTaskPausedState(nkleinTaskSessionService?.getSummary(body.taskId) ?? null, pausedTaskIds);
		return {
			ok: true,
			summary,
			pausedTaskIds: [...pausedTaskIds].sort(),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const pausedTaskIds = await readPausedTasks(workspaceScope.workspacePath);
		return {
			ok: false,
			summary: null,
			pausedTaskIds: [...pausedTaskIds].sort(),
			error: message,
		};
	}
}

/**
 * Resume a task (the runtime-api `resumeTask` procedure handler). Clears the paused flag, resumes the
 * scoped session service, and falls back to rebinding a persisted session / nudging a paused-or-awaiting
 * task with a continue prompt so a previously-paused card actually moves again.
 */
export async function handleResumeTask(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeTaskPauseRequest,
	deps: TaskPauseResumeDeps,
): Promise<RuntimeTaskPauseResponse> {
	try {
		const body = parseTaskPauseRequest(input);
		const wasTaskPaused = (await readPausedTasks(workspaceScope.workspacePath)).has(body.taskId);
		const pausedTaskIds = await setCardPaused({
			workspacePath: workspaceScope.workspacePath,
			taskId: body.taskId,
			paused: false,
		});
		const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
		nkleinTaskSessionService.setCardPaused(body.taskId, false);
		const resumedSummaries = await nkleinTaskSessionService.resumePausedTasks();
		let resumedSummary = resumedSummaries.find((summary) => summary.taskId === body.taskId) ?? null;
		let fallbackSummary = nkleinTaskSessionService.getSummary(body.taskId);
		if (!resumedSummary && !fallbackSummary && wasTaskPaused) {
			fallbackSummary = await nkleinTaskSessionService.rebindPersistedTaskSession(body.taskId).catch(() => null);
		}
		if (
			!resumedSummary &&
			wasTaskPaused &&
			(fallbackSummary?.state === "paused" || fallbackSummary?.state === "awaiting_review")
		) {
			resumedSummary = await nkleinTaskSessionService.sendTaskSessionInput(
				body.taskId,
				"Continue from the paused checkpoint.",
			);
			fallbackSummary = resumedSummary ?? fallbackSummary;
		}
		return {
			ok: true,
			summary: withTaskPausedState(resumedSummary ?? fallbackSummary, pausedTaskIds),
			pausedTaskIds: [...pausedTaskIds].sort(),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const pausedTaskIds = await readPausedTasks(workspaceScope.workspacePath);
		return {
			ok: false,
			summary: null,
			pausedTaskIds: [...pausedTaskIds].sort(),
			error: message,
		};
	}
}
