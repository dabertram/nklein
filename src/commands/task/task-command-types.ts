/**
 * Shared types + constants for the `nklein task` CLI commands, extracted from the oversized `task.ts` (todo §5.U). The
 * board columns a task can be listed/targeted in (`LIST_TASK_COLUMNS` / `ListTaskColumn`), the raw `--task-id` /
 * `--column` flag pair a subcommand receives (`TaskCommandTarget`), and the discriminated result of resolving it
 * (exactly one must be set). Kept separate so the command modules and `task.ts` share one source of truth.
 */

export const LIST_TASK_COLUMNS = ["backlog", "planning", "in_progress", "review", "completed", "trash"] as const;

export type ListTaskColumn = (typeof LIST_TASK_COLUMNS)[number];

export type TaskCommandTarget = { taskId?: string; column?: ListTaskColumn };

export type ResolvedTaskCommandTarget =
	| {
			kind: "task";
			taskId: string;
	  }
	| {
			kind: "column";
			column: ListTaskColumn;
	  };

/** The columns whose cards can have a live agent session running — so finishing/deleting one must stop it first. */
export function columnCanHaveLiveTaskSession(columnId: ListTaskColumn): boolean {
	return columnId === "planning" || columnId === "in_progress" || columnId === "review";
}
