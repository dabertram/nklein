/**
 * F12.38 compacted decision-handoff between dependent cards — PURE core.
 *
 * When card B depends on card A, today's handoff is the diff + B's own prompt — none of A's DECISIONS survive
 * (which approach was chosen and why, which edge cases were found, what the reviewer demanded). Inter-agent
 * misalignment is ~37% of MAST failures, and this thin handoff invites exactly that. This composer builds a compact
 * handoff brief from A's LEDGERED FACTS — completed plan steps, files touched, review feedback that shaped the
 * result, salvage events — deterministically (no model call; an optional model-written summary can enrich the
 * `workerNotes` slot when the fleet is available). The brief rides dependent-card B's start prompt.
 */

import type { RuntimeBoardCard, RuntimeBoardData } from "./board-api-contract";
import { findBoardCardWithColumn } from "./task-board-mutations";

export interface HandoffSourceFacts {
	readonly taskId: string;
	readonly title: string;
	/** Focus-chain steps A completed, in order (its own plan trace). */
	readonly completedSteps: readonly string[];
	/** Files A actually touched (the artifact anchor for B's reading list). */
	readonly filesTouched: readonly string[];
	/** The reviewer's LAST change-request feedback that shaped the accepted result (null when clean-approved). */
	readonly shapingReviewFeedback: string | null;
	/** Optional model-written decision notes (fleet-enriched); null in the deterministic-only path. */
	readonly workerNotes: string | null;
}

const MAX_STEPS = 6;
const MAX_FILES = 10;

/**
 * Render the handoff brief for a dependent card's prompt. Compact by contract: capped lists, one block, and only
 * sections with content — an empty handoff renders null (nothing to say beats boilerplate).
 */
export function buildDecisionHandoff(source: HandoffSourceFacts): string | null {
	const lines: string[] = [];
	if (source.completedSteps.length > 0) {
		lines.push(
			`What "${source.title}" actually did (its completed plan steps):`,
			...source.completedSteps.slice(0, MAX_STEPS).map((step) => `- ${step}`),
		);
		if (source.completedSteps.length > MAX_STEPS) {
			lines.push(`- …and ${source.completedSteps.length - MAX_STEPS} more step(s)`);
		}
	}
	if (source.filesTouched.length > 0) {
		lines.push(
			`Files it changed (read these before assuming their shape): ${source.filesTouched
				.slice(0, MAX_FILES)
				.join(
					", ",
				)}${source.filesTouched.length > MAX_FILES ? ` (+${source.filesTouched.length - MAX_FILES} more)` : ""}`,
		);
	}
	if (source.shapingReviewFeedback?.trim()) {
		lines.push(
			`Review constraint that SHAPED the accepted result (still binding on follow-up work): ${source.shapingReviewFeedback.trim().slice(0, 300)}`,
		);
	}
	if (source.workerNotes?.trim()) {
		lines.push(
			`Decisions and edge cases in the upstream worker's own words: ${source.workerNotes.trim().slice(0, 500)}`,
		);
	}
	if (lines.length === 0) {
		return null;
	}
	return [`[Handoff from the dependency "${source.title}" (${source.taskId})]`, ...lines].join("\n");
}

/** Compact by contract: at most this many upstream briefs ride a start prompt; the remainder is counted honestly. */
const MAX_HANDOFF_BRIEFS = 3;

/**
 * The reviewer feedback that SHAPED a completed card's accepted result. Audit 2026-08-12: `review.lastFeedback` is
 * structurally NULL on a completed card — the approving round overwrites it — so this module read null forever and
 * the "review constraint" line never rendered. The shaping constraint is the newest `request_changes` round's text
 * in `review.history`; rounds recorded before the feedback-text field carry none and are skipped (older text still
 * beats no text).
 */
function lastShapingReviewFeedback(review: RuntimeBoardCard["review"]): string | null {
	const history = review?.history ?? [];
	for (let index = history.length - 1; index >= 0; index -= 1) {
		const round = history[index];
		if (round?.verdict !== "request_changes") {
			continue;
		}
		const text = round.feedback?.trim();
		if (text) {
			return text;
		}
	}
	return null;
}

/**
 * The board-level composition (F12.38 activation half): every COMPLETED upstream dependency of `taskId` becomes a
 * handoff brief, capped with an honest remainder line. Edge semantics (task-board-mutations): `fromTaskId` DEPENDS
 * ON `toTaskId`, so this card's upstream cards are the `toTaskId`s of its own outgoing edges. `filesTouched` is the
 * card's PLANNED scope (`filesLikelyTouched`) — the write-scope fence made it binding on the upstream worker, and it
 * is the right reading list for the dependent either way. Returns "" when there is nothing to hand off.
 */
export function composeDependencyHandoffPreamble(board: RuntimeBoardData, taskId: string): string {
	const briefs: string[] = [];
	// Edge-semantics slice (audit 2026-08-12): a completed prerequisite's edge is RETIRED into
	// `satisfiedDependencies` by the same mutation that completes it — the live `dependencies` walk below can
	// essentially never see a completed upstream (which is why this module was 100% dark since shipping). The
	// satisfied list is the source of truth; the live walk stays as a defensive second look (a hand-edited board).
	const upstreamTaskIds: string[] = [];
	const seenUpstream = new Set<string>();
	for (const satisfied of board.satisfiedDependencies ?? []) {
		if (
			satisfied.fromTaskId === taskId &&
			satisfied.releasedBy === "completed" &&
			!seenUpstream.has(satisfied.toTaskId)
		) {
			seenUpstream.add(satisfied.toTaskId);
			upstreamTaskIds.push(satisfied.toTaskId);
		}
	}
	for (const edge of board.dependencies) {
		if (edge.fromTaskId === taskId && !seenUpstream.has(edge.toTaskId)) {
			seenUpstream.add(edge.toTaskId);
			upstreamTaskIds.push(edge.toTaskId);
		}
	}
	for (const upstreamTaskId of upstreamTaskIds) {
		const upstream = findBoardCardWithColumn(board, upstreamTaskId);
		if (upstream?.columnId !== "completed") {
			continue;
		}
		const brief = buildDecisionHandoff({
			taskId: upstreamTaskId,
			title: upstream.card.title?.trim() || upstreamTaskId,
			completedSteps: (upstream.card.focusChain?.steps ?? [])
				.filter((step) => step.status === "done")
				.map((step) => step.text),
			filesTouched: upstream.card.filesLikelyTouched ?? [],
			shapingReviewFeedback: lastShapingReviewFeedback(upstream.card.review),
			workerNotes: null,
		});
		if (brief) {
			briefs.push(brief);
		}
	}
	if (briefs.length === 0) {
		return "";
	}
	const omitted = briefs.length - MAX_HANDOFF_BRIEFS;
	return `${briefs.slice(0, MAX_HANDOFF_BRIEFS).join("\n\n")}${
		omitted > 0 ? `\n\n(+${omitted} more completed-dependency handoff(s) omitted to protect the context budget)` : ""
	}\n\n`;
}
