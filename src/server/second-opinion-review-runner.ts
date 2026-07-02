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
import type { RuntimeBoardCard, RuntimeBoardData, RuntimeCardReview } from "../core/api-contract";
import { modelsShareLineage, resolveLineage } from "../core/model-lineage";
import type { ReviewBoardContext, ReviewRelatedCard } from "../core/review-orchestration";
import type { RuntimeTaskAcceptanceResult } from "../core/task-lifecycle-api-contract";
import {
	type NKleinSecondOpinionReviewOutcome,
	runNKleinSecondOpinionReview,
} from "../nklein-agent/nklein-second-opinion-review";
import type { NKleinTaskSessionService } from "../nklein-agent/nklein-task-session-service";
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
	service: Pick<NKleinTaskSessionService, "runSecondOpinionReviewSession" | "sendTaskSessionInput" | "getSummary"> &
		Partial<Pick<NKleinTaskSessionService, "verifyTaskAcceptanceInSandbox">>;
	loadWorkspaceState?: typeof loadWorkspaceState;
	mutateWorkspaceState?: typeof mutateWorkspaceState;
	loadRuntimeConfig?: typeof loadRuntimeConfig;
	getTaskResultBranchDiff?: typeof getTaskResultBranchDiff;
	now?: () => number;
	/** Sink for surfaced-but-non-blocking signals (e.g. the reviewer-monoculture waiver, §5.AB W0.4). */
	warn?: (message: string) => void;
}

const REVIEW_PLAN_OBJECTIVE_BUDGET = 2_000;

/**
 * Derives the card's board/plan context for the reviewer: the plan objective it serves, its prerequisites
 * (cards it depends on), its dependents (cards depending on it), and its sibling cards from the same plan — so
 * the reviewer judges fit, scope, and coherence across the board, not the card in isolation. A dependency edge
 * `fromTaskId → toTaskId` means `fromTaskId` depends on `toTaskId`.
 */
export function buildReviewBoardContext(board: RuntimeBoardData, card: RuntimeBoardCard): ReviewBoardContext {
	const byId = new Map<string, ReviewRelatedCard>();
	for (const column of board.columns) {
		for (const entry of column.cards) {
			byId.set(entry.id, { title: entry.title ?? entry.id, column: column.id });
		}
	}
	const dependsOn: ReviewRelatedCard[] = [];
	const dependedOnBy: ReviewRelatedCard[] = [];
	for (const dependency of board.dependencies) {
		if (dependency.fromTaskId === card.id) {
			const related = byId.get(dependency.toTaskId);
			if (related) {
				dependsOn.push(related);
			}
		} else if (dependency.toTaskId === card.id) {
			const related = byId.get(dependency.fromTaskId);
			if (related) {
				dependedOnBy.push(related);
			}
		}
	}
	const planTaskId = card.generatedFromPlan?.planTaskId ?? null;
	const siblings: ReviewRelatedCard[] = [];
	let planObjective: string | null = null;
	if (planTaskId) {
		for (const column of board.columns) {
			for (const entry of column.cards) {
				if (entry.id === planTaskId) {
					planObjective = entry.prompt.slice(0, REVIEW_PLAN_OBJECTIVE_BUDGET);
				} else if (entry.id !== card.id && entry.generatedFromPlan?.planTaskId === planTaskId) {
					siblings.push({ title: entry.title ?? entry.id, column: column.id });
				}
			}
		}
	}
	return {
		planObjective,
		...(dependsOn.length > 0 ? { dependsOn } : {}),
		...(dependedOnBy.length > 0 ? { dependedOnBy } : {}),
		...(siblings.length > 0 ? { siblings } : {}),
	};
}

/** Bound tail of acceptance output shown to the reviewer (enough to judge a failure, small enough for tiny windows). */
const ACCEPTANCE_OUTPUT_TAIL_BUDGET = 800;

/**
 * Format an acceptance result into the reviewer-facing "## Acceptance check" summary (W1.5). Pure. Null when there
 * is nothing meaningful to tell the reviewer (no check ran and none exists — the core omits the section entirely).
 * A failing or MISSING acceptance is framed as strong request-changes grounds (fail-closed posture, W0.1).
 */
export function formatAcceptanceSummaryForReview(
	acceptance: Pick<RuntimeTaskAcceptanceResult, "present" | "command" | "passed" | "exitCode" | "output"> | null,
): string | null {
	if (acceptance === null) {
		return "Acceptance evidence UNAVAILABLE (the check could not run). Treat completion claims skeptically — the delivery gate will fail closed without a passing acceptance run.";
	}
	if (acceptance.present !== true) {
		return "NO acceptance command exists on this card. Treat this as strong grounds to request changes (every card should carry a machine-runnable acceptance check); auto-delivery is held without one.";
	}
	const verdict = acceptance.passed === true ? "PASSED" : `FAILED (exit ${acceptance.exitCode ?? "?"})`;
	const outputTail = acceptance.output.trim().slice(-ACCEPTANCE_OUTPUT_TAIL_BUDGET);
	return [
		`Command: \`${acceptance.command ?? "?"}\` — ${verdict}.`,
		...(acceptance.passed === true
			? []
			: [
					"A failing acceptance check is strong grounds to request changes — reconcile the worker's claims against this result.",
				]),
		...(outputTail && acceptance.passed !== true ? ["", "Output tail:", "```", outputTail, "```"] : []),
	].join("\n");
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
	const reviewerRole = config.effectiveModelRoles?.reviewer ?? null;
	const reviewer =
		reviewerRole?.providerId && reviewerRole.modelId
			? { providerId: reviewerRole.providerId, modelId: reviewerRole.modelId }
			: null;
	// §5.AB reasoning-diversity observability (audit W0.4): a reviewer sharing the WORKER's lineage is a
	// CORRELATED second opinion (same-family models agree on wrong answers ~60% — research 2026-07-02). Surfaced,
	// not blocked — the auto-selection wiring (W2.5) will prefer a diverse reviewer via applyDiversityPreference;
	// until then the waiver must at least be visible instead of silently monocultural.
	const workerModelId = input.service.getSummary(input.taskId)?.modelId ?? null;
	if (reviewer && workerModelId && modelsShareLineage(workerModelId, reviewer.modelId)) {
		input.warn?.(
			`Reviewer ${reviewer.modelId} shares the ${resolveLineage(reviewer.modelId)} lineage with worker ` +
				`${workerModelId} on ${input.taskId} — correlated second opinion (diversity waived).`,
		);
	}

	const persistReview = async (review: RuntimeCardReview, targetColumnId?: string): Promise<void> => {
		await mutate(input.workspacePath, (current) => ({
			board: applyCardReviewToBoard(current.board, input.taskId, review, targetColumnId, now),
			value: null,
		}));
	};

	// W1.5 (audit 2026-07-02): run the ACCEPTANCE check BEFORE the review, deterministically, and hand the reviewer
	// its result — previously acceptanceSummary was never populated, so the reviewer judged the diff with zero
	// knowledge of whether acceptance passed/failed/exists (an opinion, not an evidence-backed gate). Best-effort:
	// an unavailable check (no sandbox / method absent on a fake) yields null and the reviewer is told so.
	const acceptance = config.secondOpinionReviewEnabled
		? await (async () => {
				try {
					return (
						(await input.service.verifyTaskAcceptanceInSandbox?.({
							taskId: input.taskId,
							projectRepoPath: input.workspacePath,
							baseRef: card.baseRef,
							taskPrompt: card.prompt,
						})) ?? null
					);
				} catch {
					return null;
				}
			})()
		: null;

	return runNKleinSecondOpinionReview({
		taskId: input.taskId,
		columnId,
		enabled: config.secondOpinionReviewEnabled,
		maxRounds: config.reviewMaxRounds,
		isReviewerCard: input.taskId.includes(REVIEW_SESSION_TASK_SUFFIX),
		acceptanceSummary: formatAcceptanceSummaryForReview(acceptance),
		now,
		deps: {
			getCard: async () => ({
				id: card.id,
				title: card.title ?? card.id,
				prompt: card.prompt,
				review: card.review,
				focusChain: card.focusChain ?? null,
			}),
			getTaskDiff: async () =>
				getDiff({ repoPath: input.workspacePath, taskId: input.taskId, baseRef: card.baseRef }),
			getReviewContext: async () => ({
				workerReasoning: input.service.getSummary(input.taskId)?.latestHookActivity?.finalMessage?.trim() || null,
				boardContext: buildReviewBoardContext(state.board, card),
			}),
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
