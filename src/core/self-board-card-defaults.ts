/**
 * F2.36 (d) — the START SHAPE of the cards the self-board sync mirrors from the plan documents. PURE core.
 *
 * "Work this card with !Klein" is the ordinary Start on a `todo:` card of the repo's own board: that board
 * exists only once the dev checkout has been added as a project through the self-improvement flow — dev-only
 * (`NODE_ENV=development`) and confirmation-gated (`confirmSelfProject`) — so the gate the item asks for sits at
 * the project, not on every card. What the sync controls is the shape the card starts with:
 *
 * ── A BACKLOG ITEM STARTS IN PLAN MODE ──
 * A todo entry is a work package, not a leaf: up to 2,400 characters of history, decisions and remaining legs.
 * Handing that to one worker as a single card is how weak models wander (the decompose-over-explores and
 * refinement-stall findings). Plan mode puts the architect first — it turns the entry into child cards on the
 * self board, the DAG the item exists to show — and the workers get leaves. A done package never starts; it is
 * the historical spine.
 */

export type SelfBoardCardKind = "todo" | "done";

export interface SelfBoardCardStartDefaults {
	readonly startInPlanMode: boolean;
	readonly autoReviewEnabled: boolean;
	readonly autoReviewMode: "commit";
	readonly agentId: "nklein";
	readonly trustedOrigin: "plan";
}

export function selfBoardCardStartDefaults(kind: SelfBoardCardKind): SelfBoardCardStartDefaults {
	return {
		startInPlanMode: kind === "todo",
		autoReviewEnabled: true,
		autoReviewMode: "commit",
		agentId: "nklein",
		trustedOrigin: "plan",
	};
}
