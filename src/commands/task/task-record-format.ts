import type {
	RuntimeBoardCard,
	RuntimeBoardColumnId,
	RuntimeBoardDependency,
	RuntimeWorkspaceStateResponse,
} from "../../core/api-contract";
import { getTaskColumnId, type RuntimeAddTaskDependencyResult } from "../../core/task-board-mutations";
import {
	LIST_TASK_COLUMNS,
	type ListTaskColumn,
	type ResolvedTaskCommandTarget,
	type TaskCommandTarget,
} from "./task-command-types.js";
import { formatTaskNKleinSettings } from "./task-nklein-settings.js";

/**
 * Pure board-record query, formatting, and target/column resolution for the `nklein task` CLI, extracted from the
 * oversized `task.ts` (todo §5.U). Finds cards/columns in a workspace board snapshot, formats them (and dependency
 * records) into the JSON payloads the CLI prints, resolves the `--task-id`/`--column` target, parses the `--column`
 * flag, and maps a link-failure reason to its message. No I/O — pure functions over a `RuntimeWorkspaceStateResponse`.
 */

export function resolveTaskCommandTarget(input: TaskCommandTarget, commandName: string): ResolvedTaskCommandTarget {
	const taskId = input.taskId?.trim();
	const column = input.column;
	// Mutual-exclusivity is decided by flag PRESENCE, not the trimmed value: a whitespace-only `--task-id`
	// trims to '' but the user still supplied it, so pairing it with `--column` is the ambiguous both-flags
	// case. Testing the trimmed value here let `--task-id '  ' --column review` skip this error and fall
	// through to a column target — turning `task delete` into a silent DELETE-EVERY-CARD-IN-THE-COLUMN.
	const hasTaskIdFlag = input.taskId !== undefined;
	const hasColumnFlag = column !== undefined;
	if (hasTaskIdFlag && hasColumnFlag) {
		throw new Error(`${commandName} accepts exactly one of --task-id or --column.`);
	}
	if (taskId) {
		return {
			kind: "task",
			taskId,
		};
	}
	if (column) {
		return {
			kind: "column",
			column,
		};
	}
	throw new Error(`${commandName} requires either --task-id or --column.`);
}

export function parseListColumn(value: string | undefined): ListTaskColumn | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "done") {
		return "completed";
	}
	if (
		value === "backlog" ||
		value === "planning" ||
		value === "in_progress" ||
		value === "review" ||
		value === "completed" ||
		value === "trash"
	) {
		return value;
	}
	throw new Error(`Invalid column "${value}". Expected one of: ${LIST_TASK_COLUMNS.join(", ")}, done.`);
}

export function findTaskRecord(
	state: RuntimeWorkspaceStateResponse,
	taskId: string,
): { task: RuntimeBoardCard; columnId: RuntimeBoardColumnId } | null {
	for (const column of state.board.columns) {
		const task = column.cards.find((candidate) => candidate.id === taskId);
		if (task) {
			return {
				task,
				columnId: column.id,
			};
		}
	}
	return null;
}

export function formatTaskRecord(
	state: RuntimeWorkspaceStateResponse,
	task: RuntimeBoardCard,
	columnId: RuntimeBoardColumnId,
): Record<string, unknown> {
	const session = state.sessions[task.id] ?? null;
	return {
		id: task.id,
		prompt: task.prompt,
		column: columnId,
		baseRef: task.baseRef,
		startInPlanMode: task.startInPlanMode,
		autoReviewEnabled: task.autoReviewEnabled === true,
		autoReviewMode: task.autoReviewMode ?? "commit",
		...(task.agentId ? { agentId: task.agentId } : {}),
		...formatTaskNKleinSettings(task.nkleinSettings),
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
		session: session
			? {
					state: session.state,
					agentId: session.agentId,
					pid: session.pid,
					startedAt: session.startedAt,
					updatedAt: session.updatedAt,
					lastOutputAt: session.lastOutputAt,
					reviewReason: session.reviewReason,
					exitCode: session.exitCode,
				}
			: null,
	};
}

export function formatDependencyRecord(
	state: RuntimeWorkspaceStateResponse,
	dependency: RuntimeBoardDependency,
): Record<string, unknown> {
	return {
		id: dependency.id,
		backlogTaskId: dependency.fromTaskId,
		backlogTaskColumn: getTaskColumnId(state.board, dependency.fromTaskId),
		linkedTaskId: dependency.toTaskId,
		linkedTaskColumn: getTaskColumnId(state.board, dependency.toTaskId),
		createdAt: dependency.createdAt,
	};
}

export function getLinkFailureMessage(reason: RuntimeAddTaskDependencyResult["reason"]): string {
	if (reason === "same_task") {
		return "A task cannot be linked to itself.";
	}
	if (reason === "duplicate") {
		return "These tasks are already linked.";
	}
	if (reason === "trash_task") {
		return "Links cannot include done tasks.";
	}
	if (reason === "non_backlog") {
		return "Links require at least one backlog task.";
	}
	if (reason === "would_create_cycle") {
		return "That link would create a dependency cycle (the tasks would deadlock, none could start).";
	}
	return "One or both tasks could not be found.";
}

export function findTasksInColumn(
	state: RuntimeWorkspaceStateResponse,
	columnId: ListTaskColumn,
): Array<{ task: RuntimeBoardCard; columnId: RuntimeBoardColumnId }> {
	const column = state.board.columns.find((candidate) => candidate.id === columnId);
	if (!column) {
		return [];
	}
	return column.cards.map((task) => ({
		task,
		columnId: column.id,
	}));
}
