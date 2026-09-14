import { describe, expect, it } from "vitest";
import { selfBoardCardStartDefaults } from "../../../src/core/self-board-card-defaults";

/**
 * F2.36 (d): "work this card with !Klein" is the ordinary Start on a self-board todo card. A backlog entry is a
 * work package, not a leaf — it starts in PLAN mode so the architect turns it into child cards before any
 * worker touches the dev checkout; a done package is the historical spine and never starts.
 */
describe("selfBoardCardStartDefaults", () => {
	it("starts a todo card in plan mode, reviewed, on the nklein agent", () => {
		expect(selfBoardCardStartDefaults("todo")).toEqual({
			startInPlanMode: true,
			autoReviewEnabled: true,
			autoReviewMode: "commit",
			agentId: "nklein",
			trustedOrigin: "plan",
		});
	});

	it("does not put a done package into plan mode — the spine is history, not work", () => {
		expect(selfBoardCardStartDefaults("done").startInPlanMode).toBe(false);
	});
});
