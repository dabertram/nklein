/**
 * Live second-opinion review runner (todo.md §5.K).
 *
 * The state hub calls this when a worker card becomes reviewable. It wires the pure
 * {@link runNKleinSecondOpinionReview} orchestrator to real I/O — runtime config (is review on, the round cap,
 * the reviewer model), the board (the card + its diff), the reviewer session (via the task-session service), and
 * the board transitions (persist the review round; on bounce move the card back to In Progress and re-drive the
 * worker; on park flag it). All I/O is injectable so the wiring is unit-testable without a live model or Docker;
 * the reviewer session itself (`service.runSecondOpinionReviewSession`) is the one piece that needs a live model.
 */

import { loadRuntimeConfig } from "../config/runtime-config";
import type { RuntimeBoardData, RuntimeCardReview } from "../core/api-contract";
import {
	type NKleinSecondOpinionReviewOutcome,
	runNKleinSecondOpinionReview,
} from "../nklein-sdk/nklein-second-opinion-review";
import type { NKleinTaskSessionService } from "../nklein-sdk/nklein-task-session-service";
import { loadWorkspaceState, mutateWorkspaceState } from "../state/workspace-state";
import { getTaskResultBranchDiff } from "../workspace/task-result-branches";

/** Suffix the service uses for the isolated reviewer session id; guards against reviewing a review. */
const REVIEW_SESSION_TASK_SUFFIX = "::review";

/** Returns a new board with the card's review state set, optionally moving it to `targetColumnId`. */
export function applyCardReviewToBoard(
	board: RuntimeBoardData,
	taskId: string,
	review: RuntimeCardReview,
	targetColumnId?: string,
	now: () => number = Date.now,
): RuntimeBoardData {
	let movedCard: RuntimeBoardData["columns"][number]["cards"][number] | null = null;
	const columns = board.columns.map((column) => {
		const existing = column.cards.find((card) => card.id === taskId);
		if (!existing) {
			return column;
		}
		const updated = { ...existing, review, updatedAt: now() };
		if (targetColumnId && targetColumnId !== column.id) {
			movedCard = updated;
			return { ...column, cards: column.cards.filter((card) => card.id !== taskId) };
		}
		return { ...column, cards: column.cards.map((card) => (card.id === taskId ? updated : card)) };
	});
	if (movedCard && targetColumnId) {
		const landed: RuntimeBoardData["columns"][number]["cards"][number] = movedCard;
		return {
			...board,
			columns: columns.map((column) =>
				column.id === targetColumnId ? { ...column, cards: [...column.cards, landed] } : column,
			),
		};
	}
	return { ...board, columns };
}

export interface RunSecondOpinionReviewForTaskInput {
	workspacePath: string;
	taskId: string;
	service: Pick<NKleinTaskSessionService, "runSecondOpinionReviewSession" | "sendTaskSessionInput">;
	loadWorkspaceState?: typeof loadWorkspaceState;
	mutateWorkspaceState?: typeof mutateWorkspaceState;
	loadRuntimeConfig?: typeof loadRuntimeConfig;
	getTaskResultBranchDiff?: typeof getTaskResultBranchDiff;
	now?: () => number;
}

export async function runSecondOpinionReviewForTask(
	input: RunSecondOpinionReviewForTaskInput,
): Promise<NKleinSecondOpinionReviewOutcome> {
	const loadState = input.loadWorkspaceState ?? loadWorkspaceState;
	const mutate = input.mutateWorkspaceState ?? mutateWorkspaceState;
	const loadConfig = input.loadRuntimeConfig ?? loadRuntimeConfig;
	const getDiff = input.getTaskResultBranchDiff ?? getTaskResultBranchDiff;
	const now = input.now ?? Date.now;

	const config = await loadConfig(input.workspacePath);
	const state = await loadState(input.workspacePath);
	const located = state.board.columns
		.flatMap((column) => column.cards.map((card) => ({ columnId: column.id, card })))
		.find((entry) => entry.card.id === input.taskId);
	if (!located) {
		return { type: "skipped", reason: "card_not_found" };
	}
	const { card, columnId } = located;
	const reviewerRole = config.modelRoles?.reviewer ?? null;
	const reviewer =
		reviewerRole?.providerId && reviewerRole.modelId
			? { providerId: reviewerRole.providerId, modelId: reviewerRole.modelId }
			: null;

	const persistReview = async (review: RuntimeCardReview, targetColumnId?: string): Promise<void> => {
		await mutate(input.workspacePath, (current) => ({
			board: applyCardReviewToBoard(current.board, input.taskId, review, targetColumnId, now),
			value: null,
		}));
	};

	return runNKleinSecondOpinionReview({
		taskId: input.taskId,
		columnId,
		enabled: config.secondOpinionReviewEnabled,
		maxRounds: config.reviewMaxRounds,
		isReviewerCard: input.taskId.includes(REVIEW_SESSION_TASK_SUFFIX),
		now,
		deps: {
			getCard: async () => ({
				id: card.id,
				title: card.title ?? card.id,
				prompt: card.prompt,
				review: card.review,
			}),
			getTaskDiff: async () =>
				getDiff({ repoPath: input.workspacePath, taskId: input.taskId, baseRef: card.baseRef }),
			runReviewSession: async ({ seedPrompt }) =>
				input.service.runSecondOpinionReviewSession({
					taskId: input.taskId,
					projectRepoPath: input.workspacePath,
					baseRef: card.baseRef,
					seedPrompt,
					reviewer,
				}),
			onDeliver: async ({ review }) => {
				await persistReview(review);
			},
			onBounce: async ({ review, workerPrompt }) => {
				await persistReview(review, "in_progress");
				await input.service.sendTaskSessionInput(input.taskId, workerPrompt, "act");
			},
			onPark: async ({ review }) => {
				await persistReview(review);
			},
		},
	});
}
