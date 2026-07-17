import { TRPCError } from "@trpc/server";
import type { RuntimeTaskAcceptanceVerifyRequest, RuntimeTaskAcceptanceVerifyResponse } from "../../core/api-contract";
import { cardVerificationFromAcceptance } from "../../core/delivery-evidence";
import { findBoardCardWithColumn } from "../../core/task-board-mutations";
import type { NKleinTaskSessionService } from "../../nklein-agent/nklein-task-session-service";
import { persistCardVerification } from "../../server/persist-card-verification";
import { loadWorkspaceState } from "../../state/workspace-state";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";
import { formatAcceptanceVerifyMessage } from "../runtime-task-message-formatting";

/**
 * Run a task's Acceptance check in its sandbox (the runtime-api `verifyTaskAcceptance` procedure
 * handler, extracted from the factory). The only factory dependency — the scoped task-session
 * service resolver — is passed in, so the lift is behavior-preserving. Throws NOT_FOUND when the task
 * is not on the board; otherwise returns the acceptance result with a user-facing message.
 */
export async function handleVerifyTaskAcceptance(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeTaskAcceptanceVerifyRequest,
	deps: {
		getScopedNKleinTaskSessionService: (scope: RuntimeTrpcWorkspaceScope) => Promise<NKleinTaskSessionService>;
	},
): Promise<RuntimeTaskAcceptanceVerifyResponse> {
	const state = await loadWorkspaceState(workspaceScope.workspacePath);
	const taskRecord = findBoardCardWithColumn(state.board, input.taskId);
	if (!taskRecord) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Task "${input.taskId}" was not found.`,
		});
	}
	const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
	const acceptance = await nkleinTaskSessionService.verifyTaskAcceptanceInSandbox({
		taskId: input.taskId,
		projectRepoPath: workspaceScope.workspacePath,
		baseRef: taskRecord.card.baseRef,
		taskPrompt: taskRecord.card.prompt,
		timeoutMs: input.timeoutMs,
	});
	// F12.53: persist the snapshot onto the card so the badge + merge-warn read the newest REAL run. Best-effort.
	void persistCardVerification(
		workspaceScope.workspacePath,
		input.taskId,
		cardVerificationFromAcceptance(acceptance, Date.now()),
	).catch(() => {});
	return {
		ok: acceptance.present === true && acceptance.passed === true,
		taskId: input.taskId,
		taskWorkspacePath: null,
		acceptance,
		message: formatAcceptanceVerifyMessage(acceptance),
	};
}
