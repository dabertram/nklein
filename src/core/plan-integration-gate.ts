import type { RuntimeBoardCard, RuntimeBoardData } from "./api-contract";
import { findBoardCardWithColumn } from "./task-board-mutations";

/**
 * Plan-level integration gate — pure core (todo §5.0.5, decision 2026-07-02: "YES, gate the plan").
 *
 * A decomposition's cards each pass their OWN acceptance check in isolation, but the per-card sandboxes never see
 * each other's merges — so a plan can go all-green card-by-card while the fully-MERGED tree is broken. This module
 * answers the two pure questions the runtime wiring needs when a card completes:
 *
 *  1. {@link findJustCompletedPlans} — did this completion finish a whole plan (was it the LAST non-terminal
 *     member)?
 *  2. {@link resolvePlanAcceptanceCommand} — which project-level command should the gate run for that plan?
 *
 * Plan MEMBERSHIP mirrors `buildReviewBoardContext` (second-opinion-review-runner): a member is any card carrying
 * `generatedFromPlan` for the plan — here keyed by `planSlug`, the stable plan identity. Cards in the `trash` lane
 * are EXCLUDED from membership entirely (a trashed member neither blocks completion nor votes on the command);
 * `completed` is the sole terminal lane.
 */

/**
 * Mirrors `ACCEPTANCE_CHECK_PATTERN` / `extractNKleinAcceptanceCommand` in
 * `src/nklein-agent/nklein-acceptance-gate.ts`. Reimplemented locally (keep in sync) because the core layer only
 * value-imports PURE nklein-agent modules (see narration-dialect ← nklein-narrated-tool-call), and the acceptance
 * gate module is impure — it pulls in `node:child_process` and the filesystem-backed telemetry sink, which a core
 * module must not drag along. A type-only import (the pattern auto-clarify/tool-argument-repair use) cannot carry
 * a function value.
 */
const PLAN_ACCEPTANCE_CHECK_PATTERN = /^Acceptance check:\s*(.+?)\s*$/im;

/** The sole terminal lane a plan member must reach for the plan to count as complete. */
const PLAN_TERMINAL_COLUMN_ID = "completed";
/** Trashed cards are excluded from plan membership entirely (neither block nor vote). */
const PLAN_EXCLUDED_COLUMN_ID = "trash";

export interface FindJustCompletedPlansInput {
	board: RuntimeBoardData;
	/** The card that just landed in the `completed` lane (post-mutation board). */
	completedTaskId: string;
}

/**
 * Plan slugs for which `completedTaskId` was the LAST non-terminal member: the completed card belongs to the slug
 * and every (non-trash) member of that slug now sits in `completed`. Returns `[]` for non-plan cards, for cards
 * not (yet) in the `completed` lane, and for plans that still have a straggler in any working lane. A card carries
 * at most one plan provenance, so the result has at most one slug — the array shape keeps the call site uniform.
 */
export function findJustCompletedPlans(input: FindJustCompletedPlansInput): string[] {
	const located = findBoardCardWithColumn(input.board, input.completedTaskId);
	if (!located || located.columnId !== PLAN_TERMINAL_COLUMN_ID) {
		return [];
	}
	const planSlug = located.card.generatedFromPlan?.planSlug;
	if (!planSlug) {
		return [];
	}
	for (const column of input.board.columns) {
		if (column.id === PLAN_TERMINAL_COLUMN_ID || column.id === PLAN_EXCLUDED_COLUMN_ID) {
			continue;
		}
		for (const card of column.cards) {
			if (card.generatedFromPlan?.planSlug === planSlug) {
				return []; // A member still in a working lane — the plan is not done yet.
			}
		}
	}
	return [planSlug];
}

/** All (non-trash) member cards of a plan, in board scan order (column order, then card order). */
export function listPlanMemberCards(board: RuntimeBoardData, planSlug: string): RuntimeBoardCard[] {
	const members: RuntimeBoardCard[] = [];
	for (const column of board.columns) {
		if (column.id === PLAN_EXCLUDED_COLUMN_ID) {
			continue;
		}
		for (const card of column.cards) {
			if (card.generatedFromPlan?.planSlug === planSlug) {
				members.push(card);
			}
		}
	}
	return members;
}

export interface ResolvePlanAcceptanceCommandInput {
	board: RuntimeBoardData;
	planSlug: string;
}

/**
 * The project-level acceptance command for a PLAN — v1 heuristic per the §5.0.5 decision: the most common
 * `Acceptance check:` command across the plan's (non-trash) member cards; ties break toward the first command seen
 * in board scan order. `null` when no member carries a machine-runnable acceptance command (the wiring records a
 * skipped observation and stops).
 */
export function resolvePlanAcceptanceCommand(input: ResolvePlanAcceptanceCommandInput): string | null {
	const tallies = new Map<string, { count: number; firstIndex: number }>();
	let index = 0;
	for (const member of listPlanMemberCards(input.board, input.planSlug)) {
		const command = member.prompt.match(PLAN_ACCEPTANCE_CHECK_PATTERN)?.[1]?.trim();
		if (command) {
			const tally = tallies.get(command);
			if (tally) {
				tally.count += 1;
			} else {
				tallies.set(command, { count: 1, firstIndex: index });
			}
		}
		index += 1;
	}
	let best: { command: string; count: number; firstIndex: number } | null = null;
	for (const [command, tally] of tallies) {
		if (!best || tally.count > best.count || (tally.count === best.count && tally.firstIndex < best.firstIndex)) {
			best = { command, ...tally };
		}
	}
	return best?.command ?? null;
}

/**
 * The board card a plan-gate FAILURE should be surfaced on: the plan's SOURCE card (the decompose card recorded in
 * the members' `generatedFromPlan.sourceTaskId`) when it is still on the board outside `trash`, otherwise the FIRST
 * member card of the plan. `null` only when the plan has no members at all (nothing to surface on).
 */
export function resolvePlanFailureSurfaceCardId(board: RuntimeBoardData, planSlug: string): string | null {
	const members = listPlanMemberCards(board, planSlug);
	const sourceTaskId = members.find((member) => member.generatedFromPlan?.sourceTaskId)?.generatedFromPlan
		?.sourceTaskId;
	if (sourceTaskId) {
		const source = findBoardCardWithColumn(board, sourceTaskId);
		if (source && source.columnId !== PLAN_EXCLUDED_COLUMN_ID) {
			return source.card.id;
		}
	}
	return members[0]?.id ?? null;
}
