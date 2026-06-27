import { describe, expect, it } from "vitest";
import type { RuntimeBoardCard, RuntimeBoardData } from "../../../src/core/api-contract";
import {
	collectBoardTaskIds,
	findGeneratedPlanTaskCard,
} from "../../../src/nklein-agent/decomposition/plan-task-board-apply";

// Both helpers only read `board.columns[].cards[]` (id + generatedFromPlan), so a minimal cast fixture is the seam.
function card(id: string, generatedFromPlan?: { planSlug: string; planTaskId: string }): RuntimeBoardCard {
	return { id, generatedFromPlan } as unknown as RuntimeBoardCard;
}
function board(...columns: RuntimeBoardCard[][]): RuntimeBoardData {
	return { columns: columns.map((cards) => ({ cards })) } as unknown as RuntimeBoardData;
}

describe("collectBoardTaskIds", () => {
	it("returns an empty set for a board with no cards", () => {
		expect(collectBoardTaskIds(board())).toEqual(new Set());
		expect(collectBoardTaskIds(board([], []))).toEqual(new Set());
	});

	it("collects every card id across all columns", () => {
		const result = collectBoardTaskIds(board([card("a"), card("b")], [card("c")]));
		expect(result).toEqual(new Set(["a", "b", "c"]));
	});
});

describe("findGeneratedPlanTaskCard", () => {
	const generated = card("gen-1", { planSlug: "plan-x", planTaskId: "t1" });
	const other = card("gen-2", { planSlug: "plan-x", planTaskId: "t2" });
	const plain = card("manual");
	const b = board([plain, generated], [other]);

	it("finds the card generated from the given plan slug + task id", () => {
		expect(findGeneratedPlanTaskCard({ board: b, planSlug: "plan-x", planTaskId: "t1" })).toBe(generated);
	});

	it("returns null when the plan task id does not match", () => {
		expect(findGeneratedPlanTaskCard({ board: b, planSlug: "plan-x", planTaskId: "missing" })).toBeNull();
	});

	it("returns null when the plan slug does not match", () => {
		expect(findGeneratedPlanTaskCard({ board: b, planSlug: "other-plan", planTaskId: "t1" })).toBeNull();
	});

	it("ignores cards that were not generated from a plan", () => {
		const onlyManual = board([card("m1"), card("m2")]);
		expect(findGeneratedPlanTaskCard({ board: onlyManual, planSlug: "plan-x", planTaskId: "t1" })).toBeNull();
	});
});
