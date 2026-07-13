import { toErrorMessage } from "./task-command-output.js";
import type { createRuntimeTrpcClient } from "./task-runtime-workspace.js";

/**
 * Small runtime-action helpers for the task CLI (§5.U-extracted from task.ts): stop a task's running session and delete
 * its workspace worktree. Both take an already-resolved runtime tRPC client and swallow/normalize failures so the
 * calling command flows (finish, trash) stay resilient.
 */

export async function stopTaskRuntimeSession(
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>,
	taskId: string,
): Promise<void> {
	await runtimeClient.runtime.stopTaskSession
		.mutate({
			taskId,
		})
		.catch(() => null);
}

export async function deleteTaskArtifacts(
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>,
	taskId: string,
): Promise<{ ok: boolean; error?: string }> {
	try {
		const deleted = await runtimeClient.workspace.deleteTaskArtifacts.mutate({ taskId });
		return {
			ok: deleted.ok,
			error: deleted.ok ? undefined : deleted.error,
		};
	} catch (error) {
		return {
			ok: false,
			error: toErrorMessage(error),
		};
	}
}
