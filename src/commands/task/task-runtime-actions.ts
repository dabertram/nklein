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

export async function deleteTaskWorkspace(
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>,
	taskId: string,
	options: { preserveChanges?: boolean } = {},
): Promise<{ removed: boolean; error?: string }> {
	try {
		const deleted = await runtimeClient.workspace.deleteWorktree.mutate({
			taskId,
			...(Object.hasOwn(options, "preserveChanges") ? { preserveChanges: options.preserveChanges } : {}),
		});
		return {
			removed: deleted.removed,
			error: deleted.ok ? undefined : deleted.error,
		};
	} catch (error) {
		return {
			removed: false,
			error: toErrorMessage(error),
		};
	}
}
