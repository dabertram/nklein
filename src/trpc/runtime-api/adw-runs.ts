/**
 * F12.107 — the ADW runner's tRPC handlers (list / run / status). Thin over `adw-run-service`: the agent-step
 * seeder rides the NORMAL card path (addTaskToColumn → saveState), and warming the scoped service arms the
 * board-liveness watchdog so seeded cards are swept on headless boards (the same auto-start posture as the
 * F12.106 trigger intake).
 */

import { randomUUID } from "node:crypto";
import type {
	RuntimeAdwListWorkflowsResponse,
	RuntimeAdwRunRequest,
	RuntimeAdwRunStartResponse,
	RuntimeAdwRunStatusRequest,
	RuntimeAdwRunStatusResponse,
} from "../../core/adw-run-api-contract";
import { addTaskToColumn } from "../../core/task-board-mutations";
import { getAdwRunSnapshot, listAdwWorkflowFiles, startAdwRun } from "../../server/adw-run-service";
import { mutateWorkspaceState } from "../../state/workspace-state";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";

export interface AdwRunHandlerDeps {
	warmWorkspace: (scope: RuntimeTrpcWorkspaceScope) => Promise<void>;
}

export async function handleListAdwWorkflows(
	scope: RuntimeTrpcWorkspaceScope,
): Promise<RuntimeAdwListWorkflowsResponse> {
	return { ok: true, workflows: await listAdwWorkflowFiles(scope.workspacePath) };
}

export async function handleStartAdwRun(
	scope: RuntimeTrpcWorkspaceScope,
	input: RuntimeAdwRunRequest,
	deps: AdwRunHandlerDeps,
): Promise<RuntimeAdwRunStartResponse> {
	const started = await startAdwRun({
		workspacePath: scope.workspacePath,
		workspaceId: scope.workspaceId,
		name: input.name,
		runInput: input.input,
		seedAgentCard: async (card) => {
			const created = await mutateWorkspaceState(scope.workspacePath, (state) => {
				const baseRef = state.git.currentBranch ?? state.git.defaultBranch ?? state.git.branches[0] ?? "main";
				const result = addTaskToColumn(
					state.board,
					"backlog",
					{ title: card.title, prompt: card.prompt, baseRef },
					() => randomUUID(),
				);
				return { board: result.board, value: result.task.id };
			});
			return created.value;
		},
		warmWorkspace: () => deps.warmWorkspace(scope),
	});
	return started.ok
		? { ok: true, runId: started.runId, error: null }
		: { ok: false, runId: null, error: started.error };
}

export async function handleGetAdwRunStatus(
	_scope: RuntimeTrpcWorkspaceScope,
	input: RuntimeAdwRunStatusRequest,
): Promise<RuntimeAdwRunStatusResponse> {
	const run = getAdwRunSnapshot(input.runId);
	return { ok: run !== null, run };
}
