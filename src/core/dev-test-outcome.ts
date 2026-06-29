/**
 * Dev-test run outcome classification (follow-up-6 §3.4, §3.7, §5).
 *
 * The audio-VST dev-test run was reported "green" because `npm test` passed, even though 5 of 13 cards never
 * reached Completed. follow-up-6's quality gate is that **acceptance-command success and board-completion are
 * tracked separately**: a run is only successful when every non-trash card reaches Completed (or a deliberate
 * classified terminal state). This module is the single source of truth for that classification, shared by the
 * dev-test harness and by the long-running observer (which must also be able to classify from a *persisted*
 * board read when the runtime is unreachable).
 */

export type DevTestRunOutcome =
	/** Every non-trash card reached Completed. The only fully-successful outcome. */
	| "completed"
	/** The acceptance command passed, but cards remain unfinished — code is green, workflow is not. */
	| "acceptance_green_workflow_incomplete"
	/** Cards are parked in Review/awaiting-review and nothing is progressing. */
	| "blocked_by_review_cards"
	/** Cards remain, nothing is in progress, and acceptance is not green — work has stalled. */
	| "stagnant"
	/** The runtime is unreachable and work is unfinished; classified from the last persisted board state. */
	| "runtime_down"
	/** Failed cards are present or the acceptance command failed. */
	| "failed";

export interface DevTestBoardCounts {
	completed: number;
	review: number;
	planning: number;
	inProgress: number;
	backlog: number;
	failed: number;
	trash: number;
}

export interface ClassifyDevTestRunInput {
	counts: DevTestBoardCounts;
	/** Result of the fixture acceptance command, or null when it was not (yet) run. */
	acceptancePassed: boolean | null;
	/** False when the runtime API is unreachable and this is a persisted-state read. */
	runtimeReachable: boolean;
}

export interface DevTestRunClassification {
	outcome: DevTestRunOutcome;
	/** True only for `completed`. */
	success: boolean;
	incompleteCardCount: number;
	summary: string;
}

/** Minimal board shape this module needs; satisfied by `RuntimeBoardData` and a persisted board read. */
export interface DevTestBoardLike {
	columns: ReadonlyArray<{ id: string; cards: ReadonlyArray<unknown> }>;
}

/**
 * Derives counts from board columns. `failed` is a session-state concept, not a column, so it defaults to 0
 * here; a caller with live session summaries can override it before classifying.
 */
export function countDevTestBoardColumns(board: DevTestBoardLike): DevTestBoardCounts {
	const byColumn = new Map(board.columns.map((column) => [column.id, column.cards.length]));
	return {
		completed: byColumn.get("completed") ?? 0,
		review: byColumn.get("review") ?? 0,
		planning: byColumn.get("planning") ?? 0,
		inProgress: byColumn.get("in_progress") ?? 0,
		backlog: byColumn.get("backlog") ?? 0,
		failed: 0,
		trash: byColumn.get("trash") ?? 0,
	};
}

function countIncomplete(counts: DevTestBoardCounts): number {
	return counts.review + counts.planning + counts.inProgress + counts.backlog + counts.failed;
}

export function classifyDevTestRun(input: ClassifyDevTestRunInput): DevTestRunClassification {
	const { counts, acceptancePassed, runtimeReachable } = input;
	const incompleteCardCount = countIncomplete(counts);

	const outcome = ((): DevTestRunOutcome => {
		// "Completed" requires at least one card to have actually reached Completed. An EMPTY board (or one where every
		// card was discarded to trash) trivially has zero incomplete cards, but nothing ran — that must NOT read as a
		// successful completion (it previously did, so a dev-test whose seed never materialized reported a false green).
		if (incompleteCardCount === 0 && counts.completed > 0) {
			return "completed";
		}
		if (!runtimeReachable) {
			return "runtime_down";
		}
		if (counts.failed > 0 || acceptancePassed === false) {
			return "failed";
		}
		if (acceptancePassed === true) {
			return "acceptance_green_workflow_incomplete";
		}
		if (counts.review > 0 && counts.inProgress === 0) {
			return "blocked_by_review_cards";
		}
		return "stagnant";
	})();

	return {
		outcome,
		success: outcome === "completed",
		incompleteCardCount,
		summary: formatDevTestRunSummary(outcome, counts, acceptancePassed, incompleteCardCount),
	};
}

function formatDevTestRunSummary(
	outcome: DevTestRunOutcome,
	counts: DevTestBoardCounts,
	acceptancePassed: boolean | null,
	incompleteCardCount: number,
): string {
	const acceptanceText =
		acceptancePassed === true
			? "acceptance green"
			: acceptancePassed === false
				? "acceptance failing"
				: "acceptance not run";
	const board = `completed ${counts.completed}, review ${counts.review}, planning ${counts.planning}, in-progress ${counts.inProgress}, backlog ${counts.backlog}, failed ${counts.failed}`;
	switch (outcome) {
		case "completed":
			return `Run complete: every non-trash card reached Completed (${acceptanceText}).`;
		case "acceptance_green_workflow_incomplete":
			return `Code acceptance green, workflow incomplete: ${incompleteCardCount} card(s) not Completed (${board}).`;
		case "blocked_by_review_cards":
			return `Blocked by review cards: ${counts.review} card(s) awaiting review, none in progress (${acceptanceText}).`;
		case "stagnant":
			return incompleteCardCount === 0
				? `Stagnant: no card reached Completed — the board is empty or every card was discarded (${acceptanceText}).`
				: `Stagnant: ${incompleteCardCount} card(s) remain, none in progress (${acceptanceText}).`;
		case "runtime_down":
			return `Runtime unreachable; last persisted board state has ${incompleteCardCount} unfinished card(s) (${board}).`;
		case "failed":
			return `Failed: ${counts.failed} failed card(s)${acceptancePassed === false ? " and acceptance failing" : ""} (${board}).`;
	}
}
