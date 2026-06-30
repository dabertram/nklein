import type { RuntimeSwarmStopRequest, RuntimeSwarmStopResponse } from "../../core/api-contract";
import { clearSwarmStop, readSwarmStopSignal, requestSwarmStop } from "../../core/swarm-guardrails";
import type { NKleinTaskSessionService } from "../../nklein-agent/nklein-task-session-service";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";

interface SwarmStopControlDeps {
	getLoadedScopedNKleinTaskSessionService?: (scope: RuntimeTrpcWorkspaceScope) => NKleinTaskSessionService | null;
}

/** Read the current swarm-stop signal for a workspace (the runtime-api `getSwarmStop` procedure handler). */
export async function handleGetSwarmStop(workspaceScope: RuntimeTrpcWorkspaceScope): Promise<RuntimeSwarmStopResponse> {
	return { ok: true, signal: await readSwarmStopSignal(workspaceScope.workspacePath) };
}

/**
 * Raise a swarm-stop signal and pause the board (the runtime-api `requestSwarmStop` procedure handler).
 * The loaded session-service resolver is the only factory dependency, so the lift is behavior-preserving.
 */
export async function handleRequestSwarmStop(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeSwarmStopRequest,
	deps: SwarmStopControlDeps,
): Promise<RuntimeSwarmStopResponse> {
	const signal = await requestSwarmStop({ workspacePath: workspaceScope.workspacePath, reason: input.reason });
	deps.getLoadedScopedNKleinTaskSessionService?.(workspaceScope)?.setBoardPaused(true);
	return { ok: true, signal };
}

/**
 * Clear the swarm-stop signal, un-pause the board, and resume paused tasks (the runtime-api
 * `clearSwarmStop` procedure handler).
 */
export async function handleClearSwarmStop(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	deps: SwarmStopControlDeps,
): Promise<RuntimeSwarmStopResponse> {
	await clearSwarmStop(workspaceScope.workspacePath);
	const nkleinTaskSessionService = deps.getLoadedScopedNKleinTaskSessionService?.(workspaceScope) ?? null;
	nkleinTaskSessionService?.setBoardPaused(false);
	await nkleinTaskSessionService?.resumePausedTasks();
	return { ok: true, signal: null };
}
