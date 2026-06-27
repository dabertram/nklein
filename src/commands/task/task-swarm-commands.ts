import { clearSwarmStop, requestSwarmStop } from "../../core/swarm-guardrails";
import { resolveWorkspaceRepoPath } from "./task-runtime-workspace.js";

/**
 * Swarm-stop control CLI commands (§5.U-extracted from task.ts): request a cooperative stop of a workspace's running
 * agent swarm (optionally with a reason) and clear an existing stop signal. Both are leaf commands over the swarm
 * guardrails — resolve the workspace, write/remove the stop signal, return the result.
 */

type JsonRecord = Record<string, unknown>;

export async function requestTaskSwarmStopCommand(input: {
	cwd: string;
	projectPath?: string;
	reason?: string;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const signal = await requestSwarmStop({
		workspacePath: workspaceRepoPath,
		reason: input.reason,
	});
	return {
		ok: true,
		workspacePath: workspaceRepoPath,
		signal,
	};
}

export async function clearTaskSwarmStopCommand(input: { cwd: string; projectPath?: string }): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	await clearSwarmStop(workspaceRepoPath);
	return {
		ok: true,
		workspacePath: workspaceRepoPath,
	};
}
