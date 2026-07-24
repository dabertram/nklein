import type {
	RuntimeBoardCard,
	RuntimeBoardColumn,
	RuntimeBoardColumnId,
	RuntimeBoardData,
	RuntimeBoardDependency,
	RuntimeTaskAutoReviewMode,
	RuntimeTaskImage,
} from "@/runtime/types";

export type BoardColumnId = RuntimeBoardColumnId;

export type TaskAutoReviewMode = RuntimeTaskAutoReviewMode;
export type TaskImage = RuntimeTaskImage;

export const DEFAULT_TASK_AUTO_REVIEW_MODE: TaskAutoReviewMode = "commit";
export type TaskBlockedKind = "needs_decomposition" | "local_model_required" | "agent_sandbox_unavailable";

export function resolveTaskAutoReviewMode(mode: TaskAutoReviewMode | null | undefined): TaskAutoReviewMode {
	// P21.13a: `stage` must survive resolution — coercing it to "commit" would let the browser fallback
	// auto-commit a card whose whole point is that the human authors the commit.
	if (mode === "pr" || mode === "stage") {
		return mode;
	}
	return DEFAULT_TASK_AUTO_REVIEW_MODE;
}

export function getTaskAutoReviewActionLabel(mode: TaskAutoReviewMode | null | undefined): string {
	const resolvedMode = resolveTaskAutoReviewMode(mode);
	if (resolvedMode === "pr") {
		return "PR";
	}
	if (resolvedMode === "stage") {
		return "stage";
	}
	return "commit";
}

export function getTaskAutoReviewCancelButtonLabel(mode: TaskAutoReviewMode | null | undefined): string {
	const resolvedMode = resolveTaskAutoReviewMode(mode);
	if (resolvedMode === "pr") {
		return "Cancel Auto-PR";
	}
	if (resolvedMode === "stage") {
		return "Cancel Auto-stage";
	}
	return "Cancel Auto-commit";
}

/**
 * Keep the browser's card contract structurally identical to the runtime contract. A hand-maintained UI subset made
 * newly-added durable fields disappear whenever the browser normalized and saved a board (the auto-review notice path
 * exposed this with `testEvidencePolicy`). UI-only views should derive from this type, never fork the persisted shape.
 */
export type BoardCard = RuntimeBoardCard;

export type BoardColumn = RuntimeBoardColumn;
export type BoardDependency = RuntimeBoardDependency;
export type BoardData = RuntimeBoardData;

export interface ReviewTaskWorkspaceSnapshot {
	taskId: string;
	path: string;
	branch: string | null;
	isDetached: boolean;
	headCommit: string | null;
	changedFiles: number | null;
	additions: number | null;
	deletions: number | null;
}

export interface CardSelection {
	card: BoardCard;
	column: BoardColumn;
	allColumns: BoardColumn[];
}
