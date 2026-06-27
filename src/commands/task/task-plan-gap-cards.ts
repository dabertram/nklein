import type { RuntimeBoardCard, RuntimeBoardColumnId, RuntimeWorkspaceStateResponse } from "../../core/api-contract";
import type { PlanGapKind } from "../../core/plan-gap";
import { addTaskToColumn } from "../../core/task-board-mutations";
import {
	buildPlanGapDecisionCardPrompt,
	buildPlanGapIntegrationCardPrompt,
	buildPlanGapScopeCardPrompt,
} from "./task-plan-gap-prompts.js";

/**
 * Board mutations that turn a reported plan gap into the right follow-up card (§5.U-extracted from the task CLI so the
 * gap → card concern lives in one focused module): an *integration* card to fold in out-of-scope work, a *decision*
 * card to resolve a missing/contradictory requirement, or a *scope* card that also flags the source task as needing
 * decomposition. Each is idempotent by title — re-reporting the same gap returns the existing card (`created: false`).
 */

const DEFAULT_NEEDS_DECOMPOSITION_REASON = "This task needs to be decomposed before it can start.";

function findBoardTaskByTitle(
	board: RuntimeWorkspaceStateResponse["board"],
	title: string,
): { columnId: RuntimeBoardColumnId; task: RuntimeBoardCard } | null {
	for (const column of board.columns) {
		for (const task of column.cards) {
			if (task.title === title) {
				return { columnId: column.id, task };
			}
		}
	}
	return null;
}

/** Flag a card as blocked on decomposition (no-op if the task isn't on the board). */
export function markTaskNeedsDecompositionOnBoard(
	board: RuntimeWorkspaceStateResponse["board"],
	taskId: string,
	reason: string | null | undefined,
): RuntimeWorkspaceStateResponse["board"] {
	let updated = false;
	const blockedReason = reason?.trim() || DEFAULT_NEEDS_DECOMPOSITION_REASON;
	const columns = board.columns.map((column) => {
		let columnUpdated = false;
		const cards = column.cards.map((card) => {
			if (card.id !== taskId) {
				return card;
			}
			updated = true;
			columnUpdated = true;
			return {
				...card,
				blockedKind: "needs_decomposition" as const,
				blockedReason,
				updatedAt: Date.now(),
			};
		});
		return columnUpdated ? { ...column, cards } : column;
	});
	return updated ? { ...board, columns } : board;
}

export function addPlanGapIntegrationCardToBoard(input: {
	state: RuntimeWorkspaceStateResponse;
	taskId: string;
	description: string;
	evidence?: string | null;
	baseRef: string;
	createId?: () => string;
}): {
	board: RuntimeWorkspaceStateResponse["board"];
	task: RuntimeBoardCard;
	created: boolean;
} {
	const title = `Integrate plan gap from ${input.taskId}`;
	const existing = findBoardTaskByTitle(input.state.board, title);
	if (existing) {
		return {
			board: input.state.board,
			task: existing.task,
			created: false,
		};
	}
	const created = addTaskToColumn(
		input.state.board,
		"planning",
		{
			title,
			prompt: buildPlanGapIntegrationCardPrompt(input),
			startInPlanMode: true,
			autoReviewEnabled: true,
			autoReviewMode: "commit",
			agentId: "nklein",
			baseRef: input.baseRef,
		},
		input.createId ?? (() => globalThis.crypto.randomUUID()),
	);
	return {
		board: created.board,
		task: created.task,
		created: true,
	};
}

export function addPlanGapDecisionCardToBoard(input: {
	state: RuntimeWorkspaceStateResponse;
	taskId: string;
	kind: Extract<PlanGapKind, "missing_decision" | "contradictory_requirement">;
	description: string;
	evidence?: string | null;
	baseRef: string;
	createId?: () => string;
}): {
	board: RuntimeWorkspaceStateResponse["board"];
	task: RuntimeBoardCard;
	created: boolean;
} {
	const title =
		input.kind === "contradictory_requirement"
			? `Resolve plan contradiction from ${input.taskId}`
			: `Resolve plan decision gap from ${input.taskId}`;
	const existing = findBoardTaskByTitle(input.state.board, title);
	if (existing) {
		return {
			board: input.state.board,
			task: existing.task,
			created: false,
		};
	}
	const created = addTaskToColumn(
		input.state.board,
		"planning",
		{
			title,
			prompt: buildPlanGapDecisionCardPrompt(input),
			startInPlanMode: true,
			autoReviewEnabled: false,
			autoReviewMode: "commit",
			agentId: "nklein",
			baseRef: input.baseRef,
		},
		input.createId ?? (() => globalThis.crypto.randomUUID()),
	);
	return {
		board: created.board,
		task: created.task,
		created: true,
	};
}

export function addPlanGapScopeCardToBoard(input: {
	state: RuntimeWorkspaceStateResponse;
	taskId: string;
	description: string;
	evidence?: string | null;
	baseRef: string;
	createId?: () => string;
}): {
	board: RuntimeWorkspaceStateResponse["board"];
	task: RuntimeBoardCard;
	created: boolean;
} {
	const blockedBoard = markTaskNeedsDecompositionOnBoard(
		input.state.board,
		input.taskId,
		input.description.trim() || "Plan gap reported this card is too large and needs decomposition.",
	);
	const title = `Split oversized plan gap from ${input.taskId}`;
	const existing = findBoardTaskByTitle(blockedBoard, title);
	if (existing) {
		return {
			board: blockedBoard,
			task: existing.task,
			created: false,
		};
	}
	const created = addTaskToColumn(
		blockedBoard,
		"planning",
		{
			title,
			prompt: buildPlanGapScopeCardPrompt(input),
			startInPlanMode: true,
			autoReviewEnabled: false,
			autoReviewMode: "commit",
			agentId: "nklein",
			baseRef: input.baseRef,
		},
		input.createId ?? (() => globalThis.crypto.randomUUID()),
	);
	return {
		board: created.board,
		task: created.task,
		created: true,
	};
}
