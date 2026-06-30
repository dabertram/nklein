import type { RuntimeBoardColumnId } from "../core/api-contract";
import { findBoardCardWithColumn, moveTaskToColumn } from "../core/task-board-mutations";
import { mutateWorkspaceState } from "../state/workspace-state";
import type { AgentTool } from "./sdk-agent-types";

/**
 * The Planning/Refinement → In Progress promotion tool (todo §5.B).
 *
 * Every started card now enters the **Planning** lane first and does a refinement pass (re-validate the card
 * against the current project state before doing the work — "never work an out-of-date plan"). When that pass
 * confirms the plan still holds (or after the agent updates it), the agent calls **`begin_implementation`** to
 * move ITS OWN card from Planning to In Progress and start writing the implementation. An explicit tool — rather
 * than inferring the transition from turn-end heuristics — is the robust choice against small/weak local models
 * (the same parse-and-recover / explicit-control-plane principle the decomposition tools follow).
 *
 * The tool is a TRUSTED CONTROL-PLANE mutation: it touches only the !Klein-owned board (via `mutateWorkspaceState`),
 * never the user's working tree or a shell, so it stays host-side even under strict Docker isolation. It is
 * idempotent and safe to mis-call: a card already In Progress/Review is a no-op ("continue implementing"), and a
 * completed/trashed or missing card is refused with a clear directive instead of a thrown error.
 */

/** A card the agent moved out of the refinement phase into In Progress. */
export interface NKleinCardPromotedEvent {
	workspacePath: string;
	taskId: string;
	/** The lane the card was promoted FROM (planning, or backlog if it had not reconciled yet). */
	fromColumnId: RuntimeBoardColumnId;
	/** Optional short note the agent recorded about what the refinement checked/changed. */
	refinementNotes: string | null;
}

export type NKleinCardPromotedHandler = (event: NKleinCardPromotedEvent) => Promise<void> | void;

/**
 * Lanes a card can be promoted FROM: it is still pre-implementation (queued in Backlog, or refining in Planning).
 * `in_progress`/`review` mean the agent already started implementing (idempotent no-op); `completed`/`trash` are
 * terminal.
 */
const PRE_IMPLEMENTATION_COLUMNS: ReadonlySet<RuntimeBoardColumnId> = new Set<RuntimeBoardColumnId>([
	"backlog",
	"planning",
]);

export type PromotionState = "promoted" | "already-implementing" | "planning-card" | "terminal" | "missing";

export interface PromotionOutcome {
	moved: boolean;
	fromColumnId: RuntimeBoardColumnId | null;
	state: PromotionState;
}

function readRefinementNotes(input: unknown): string | null {
	const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
	const notes = record.refinementNotes ?? record.notes ?? record.summary;
	return typeof notes === "string" && notes.trim() ? notes.trim() : null;
}

/**
 * Move a WORK card from Planning/Refinement to In Progress — the shared core of the explicit `begin_implementation`
 * tool AND the §5.B Increment C auto-promote recovery (when a work card starts editing files without first calling
 * the tool). Self-gates on the card's own `startInPlanMode` (a planning/decompose card is refused), is idempotent
 * once in progress, and a no-op for terminal/missing cards. Fires `onPromoted` only on an actual move so the runtime
 * broadcasts the board.
 */
export async function promoteCardToImplementation(input: {
	workspacePath: string;
	taskId: string;
	onPromoted?: NKleinCardPromotedHandler;
	refinementNotes?: string | null;
}): Promise<PromotionOutcome> {
	const outcome = await mutateWorkspaceState<PromotionOutcome>(input.workspacePath, (state) => {
		const located = findBoardCardWithColumn(state.board, input.taskId);
		if (located === null) {
			return { board: state.board, save: false, value: { moved: false, fromColumnId: null, state: "missing" } };
		}
		const { card, columnId } = located;
		if (columnId === "completed" || columnId === "trash") {
			return { board: state.board, save: false, value: { moved: false, fromColumnId: columnId, state: "terminal" } };
		}
		// Only WORK cards (startInPlanMode === false) promote; a planning/decompose card splits itself instead.
		if (card.startInPlanMode) {
			return {
				board: state.board,
				save: false,
				value: { moved: false, fromColumnId: columnId, state: "planning-card" },
			};
		}
		if (!PRE_IMPLEMENTATION_COLUMNS.has(columnId)) {
			return {
				board: state.board,
				save: false,
				value: { moved: false, fromColumnId: columnId, state: "already-implementing" },
			};
		}
		const movement = moveTaskToColumn(state.board, input.taskId, "in_progress");
		return {
			board: movement.board,
			save: movement.moved,
			value: { moved: movement.moved, fromColumnId: columnId, state: "promoted" },
		};
	});
	const result = outcome.value;
	if (result.moved && result.fromColumnId) {
		await input.onPromoted?.({
			workspacePath: input.workspacePath,
			taskId: input.taskId,
			fromColumnId: result.fromColumnId,
			refinementNotes: input.refinementNotes ?? null,
		});
	}
	return result;
}

export function createNKleinPromotionTool(options: {
	workspacePath: string;
	taskId: string;
	onPromoted?: NKleinCardPromotedHandler;
}): AgentTool {
	return {
		name: "begin_implementation",
		description:
			"Leave the Planning/Refinement phase and start implementing THIS card: moves it from Planning to In Progress. " +
			"Call this once your refinement pass confirms the card's objective and acceptance still hold given the current " +
			"project state (or after you have updated them) — then implement the card. If the card is badly out of date and " +
			"needs to be split into smaller cards, call `decompose_project` instead of this. Call it at most once per card.",
		// Permissive: the only field is an OPTIONAL refinement note, so the SDK never pre-rejects an empty or
		// extra-keyed call before `execute` runs (small models routinely call argument-less tools with `{}`).
		inputSchema: {
			type: "object",
			properties: {
				refinementNotes: {
					type: "string",
					description:
						"Optional one or two sentences on what your refinement checked and whether the plan changed (recorded for review).",
				},
			},
			additionalProperties: true,
		},
		async execute(input) {
			// Shared mutate + onPromoted with the §5.B Increment C auto-promote recovery (see promoteCardToImplementation).
			const result = await promoteCardToImplementation({
				workspacePath: options.workspacePath,
				taskId: options.taskId,
				onPromoted: options.onPromoted,
				refinementNotes: readRefinementNotes(input),
			});

			switch (result.state) {
				case "promoted":
					return {
						ok: true,
						promoted: true,
						instruction:
							"Refinement complete — this card is now In Progress. Implement it now: make the code changes the card calls for, run its acceptance check, and finish per the workflow. Do not call begin_implementation again for this card.",
					};
				case "already-implementing":
					return {
						ok: true,
						promoted: false,
						instruction:
							"This card is already In Progress; keep implementing it. Do not call begin_implementation again for this card.",
					};
				case "planning-card":
					return {
						ok: false,
						promoted: false,
						instruction:
							"This is a planning card, not a work card, so it cannot move straight to In Progress. If it should be split into smaller executable cards, call decompose_project; otherwise complete the planning work this card is for.",
					};
				case "terminal":
					return {
						ok: false,
						promoted: false,
						instruction:
							"This card is already finished (completed or trashed) and cannot be moved to In Progress. Stop working on it.",
					};
				default:
					return {
						ok: false,
						promoted: false,
						instruction:
							"This card is not on the board, so it cannot be promoted to In Progress. Continue your refinement with the available tools.",
					};
			}
		},
	};
}
