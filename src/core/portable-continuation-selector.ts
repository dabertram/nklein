import type { RuntimeBoardCard, RuntimeBoardData } from "./board-api-contract.js";
import type { RuntimeBoardColumnId } from "./runtime-config-api-contract.js";

/**
 * §5.F continuation-point selector — "persisted state → where to safely resume + why".
 *
 * When the committed portable board (the CRDT store) is fetched and projected on a *fresh* machine
 * (`importPortableBoard` → `RuntimeBoardData`), something has to decide which cards that machine may safely pick
 * up, which must be re-planned before touching, which are still blocked, and which are terminal — *without*
 * trusting the source machine's live runtime (sessions, sandboxes, heartbeats are all machine-local and gone).
 * This is that pure decision: it reads only the imported board's own committed shape (lane placement, review
 * state, start-blockers, the dependency DAG — all plain injected values), so the reconcile UX (§5.F, verified
 * separately under Playwright) rests on one tested rule instead of ad-hoc lane checks.
 *
 * Dispositions, most-terminal first when reported per card:
 *  • `done`            — completed/trash: nothing to continue.
 *  • `awaiting_review` — sitting in the review lane: a human verdict is owed, don't auto-resume.
 *  • `blocked`         — cannot start yet: a start-blocker (`blockedKind`) or an unsatisfied predecessor
 *                        (a dependency whose upstream card is not itself `done`).
 *  • `replan`          — was mid-work but its imported state is ambiguous/unsafe to resume blind: a working-lane
 *                        card whose review parked / requested changes, or a card stranded in a working lane with
 *                        no committed working signal. Re-plan/refine first, never blind-resume.
 *  • `resume`          — an actively-in-progress card, all predecessors satisfied and no blocker: the safe
 *                        continuation frontier — this is where the fresh machine picks up.
 *
 * Pure + deterministic: no I/O, no model, no sessions, no clock. The caller supplies the imported board; every
 * input is a plain value. Given the same board the frontier is byte-stable (id-sorted), so two machines importing
 * the same committed state independently agree on where to resume.
 */

export type ContinuationDisposition = "resume" | "replan" | "blocked" | "awaiting_review" | "done";

/** Why a card landed in its disposition — a short machine-stable reason code (never free text; UI localizes it). */
export type ContinuationReason =
	| "terminal_completed"
	| "terminal_trashed"
	| "in_review"
	| "start_blocked"
	| "dependency_unsatisfied"
	| "review_parked"
	| "review_changes_requested"
	| "no_working_signal"
	| "ready_to_resume";

export interface CardContinuation {
	taskId: string;
	disposition: ContinuationDisposition;
	reason: ContinuationReason;
	/** Task ids of predecessors (upstream `fromTaskId` of a dependency into this card) not yet `done`. */
	unsatisfiedDependencies: string[];
}

export interface ContinuationSelection {
	/** Every card's disposition, id-sorted for determinism. */
	perCard: CardContinuation[];
	/** The safe continuation frontier: `resume` cards only, in resume order (dependency-respecting, then id). */
	resumeFrontier: CardContinuation[];
	counts: Record<ContinuationDisposition, number>;
}

/** Lanes that mean the card is terminal (no work to continue). */
const TERMINAL_COLUMN_REASON: Partial<Record<RuntimeBoardColumnId, ContinuationReason>> = {
	completed: "terminal_completed",
	trash: "terminal_trashed",
};

/** Lanes where a card is understood to be mid-work (a committed "working signal"). */
const WORKING_COLUMNS: ReadonlySet<RuntimeBoardColumnId> = new Set<RuntimeBoardColumnId>(["planning", "in_progress"]);

interface FlatCard {
	card: RuntimeBoardCard;
	columnId: RuntimeBoardColumnId;
}

function flattenBoard(board: RuntimeBoardData): FlatCard[] {
	const flat: FlatCard[] = [];
	for (const column of board.columns) {
		for (const card of column.cards) {
			flat.push({ card, columnId: column.id });
		}
	}
	return flat;
}

/**
 * The set of task ids that count as "already finished upstream" — a dependency into a card is satisfied when its
 * upstream card is terminal (`completed`/`trash`) OR is absent from the imported board entirely (it was tombstoned
 * away, so it can never complete; blocking on a card that no longer exists would strand the DAG forever).
 */
function resolveSatisfiedUpstream(flat: FlatCard[]): { satisfied: Set<string>; present: Set<string> } {
	const satisfied = new Set<string>();
	const present = new Set<string>();
	for (const { card, columnId } of flat) {
		present.add(card.id);
		if (columnId === "completed" || columnId === "trash") {
			satisfied.add(card.id);
		}
	}
	return { satisfied, present };
}

function unsatisfiedDependenciesFor(
	cardId: string,
	board: RuntimeBoardData,
	satisfied: Set<string>,
	present: Set<string>,
): string[] {
	const unmet = new Set<string>();
	for (const dependency of board.dependencies) {
		if (dependency.toTaskId !== cardId) {
			continue;
		}
		// A predecessor blocks only while it is present-and-not-terminal. An absent (tombstoned) upstream cannot
		// finish, so it does not block — otherwise a deleted predecessor would freeze its dependents forever.
		if (present.has(dependency.fromTaskId) && !satisfied.has(dependency.fromTaskId)) {
			unmet.add(dependency.fromTaskId);
		}
	}
	return [...unmet].sort();
}

/**
 * Classify a single imported card. Priority order (checked top-down, most-terminal first) mirrors the disposition
 * doc above so the outcome is a single deterministic verdict.
 */
export function classifyCardContinuation(
	entry: { card: RuntimeBoardCard; columnId: RuntimeBoardColumnId },
	context: { unsatisfiedDependencies: string[] },
): CardContinuation {
	const { card, columnId } = entry;
	const unsatisfied = context.unsatisfiedDependencies;
	const base = { taskId: card.id, unsatisfiedDependencies: unsatisfied };

	// 1) Terminal lanes — nothing to continue.
	const terminalReason = TERMINAL_COLUMN_REASON[columnId];
	if (terminalReason) {
		return { ...base, disposition: "done", reason: terminalReason };
	}

	// 2) Review lane — a human verdict is owed; never auto-resume.
	if (columnId === "review") {
		return { ...base, disposition: "awaiting_review", reason: "in_review" };
	}

	// 3) Start-blocked — an explicit committed blocker on the card (needs-decomposition / local-model / sandbox).
	if (card.blockedKind !== undefined) {
		return { ...base, disposition: "blocked", reason: "start_blocked" };
	}

	// 4) Unsatisfied dependency — a predecessor is still open; can't start yet.
	if (unsatisfied.length > 0) {
		return { ...base, disposition: "blocked", reason: "dependency_unsatisfied" };
	}

	// 5) Review state says re-plan first, even in a working lane — parked or changes-requested is not blind-resumable.
	if (card.review?.status === "parked") {
		return { ...base, disposition: "replan", reason: "review_parked" };
	}
	if (card.review?.status === "changes_requested") {
		return { ...base, disposition: "replan", reason: "review_changes_requested" };
	}

	// 6) A card stranded outside a working lane (e.g. Backlog) has no committed working signal to resume from —
	//    it must be (re)planned/refined before implementation rather than blind-resumed.
	if (!WORKING_COLUMNS.has(columnId)) {
		return { ...base, disposition: "replan", reason: "no_working_signal" };
	}

	// 7) Otherwise: an in-flight working card, all predecessors done, no blocker → safe to resume.
	return { ...base, disposition: "resume", reason: "ready_to_resume" };
}

/**
 * The §5.F selector: given a portable board freshly imported on another machine (all plain injected values),
 * return every card's continuation disposition + the safe resume frontier + counts. Deterministic and stable.
 */
export function selectContinuationPoints(board: RuntimeBoardData): ContinuationSelection {
	const flat = flattenBoard(board);
	const { satisfied, present } = resolveSatisfiedUpstream(flat);

	const perCard = flat
		.map(({ card, columnId }) =>
			classifyCardContinuation(
				{ card, columnId },
				{ unsatisfiedDependencies: unsatisfiedDependenciesFor(card.id, board, satisfied, present) },
			),
		)
		.sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0));

	const counts: Record<ContinuationDisposition, number> = {
		resume: 0,
		replan: 0,
		blocked: 0,
		awaiting_review: 0,
		done: 0,
	};
	for (const entry of perCard) {
		counts[entry.disposition] += 1;
	}

	const resumeFrontier = perCard.filter((entry) => entry.disposition === "resume");

	return { perCard, resumeFrontier, counts };
}
