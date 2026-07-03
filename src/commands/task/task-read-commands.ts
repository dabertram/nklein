import { summarizeWorkspaceBoardHealth } from "../../core/operator-board-health.js";
import type { ListTaskColumn } from "./task-command-types.js";
import { formatDependencyRecord, formatTaskRecord } from "./task-record-format.js";
import { createRuntimeTrpcClient, resolveRuntimeWorkspace } from "./task-runtime-workspace.js";

/**
 * Read-only task CLI commands (§5.U-extracted from task.ts): list the board's tasks (optionally filtered to a column)
 * and the board-health rollup. Both are leaf commands — resolve the workspace, query its state, project a JSON record —
 * with no mutation and no dependency on the other task command implementations.
 */

type JsonRecord = Record<string, unknown>;

export async function listTasks(input: {
	cwd: string;
	projectPath?: string;
	column?: ListTaskColumn;
}): Promise<JsonRecord> {
	const workspace = await resolveRuntimeWorkspace(input.projectPath, input.cwd, {
		autoCreateIfMissing: false,
	});
	const runtimeClient = createRuntimeTrpcClient(workspace.workspaceId);
	const state = await runtimeClient.workspace.getState.query();

	const tasks = state.board.columns.flatMap((boardColumn) => {
		if (!input.column && boardColumn.id === "trash") {
			return [];
		}
		if (input.column && boardColumn.id !== input.column) {
			return [];
		}
		return boardColumn.cards.map((task) => formatTaskRecord(state, task, boardColumn.id));
	});

	return {
		ok: true,
		workspacePath: workspace.repoPath,
		column: input.column ?? null,
		tasks,
		dependencies: state.board.dependencies.map((dependency) => formatDependencyRecord(state, dependency)),
		count: tasks.length,
	};
}

export async function reportBoardHealth(input: { cwd: string; projectPath?: string }): Promise<JsonRecord> {
	const workspace = await resolveRuntimeWorkspace(input.projectPath, input.cwd, { autoCreateIfMissing: false });
	const runtimeClient = createRuntimeTrpcClient(workspace.workspaceId);
	const state = await runtimeClient.workspace.getState.query();
	const health = summarizeWorkspaceBoardHealth(state);
	return {
		ok: true,
		workspacePath: workspace.repoPath,
		total: health.total,
		counts: health.counts,
		byState: health.byState,
		inbox: {
			total: health.inbox.total,
			unsafeActionAcks: health.inbox.unsafeActionAcks,
			clarifyingQuestions: health.inbox.clarifyingQuestions,
			heldDeliveries: health.inbox.heldDeliveries,
			blockedOnSetup: health.inbox.blockedOnSetup,
			escalatedToOperator: health.inbox.escalatedToOperator,
		},
	};
}
