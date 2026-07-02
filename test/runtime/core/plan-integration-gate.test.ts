import { describe, expect, it } from "vitest";
import type { RuntimeBoardCard, RuntimeBoardData } from "../../../src/core/api-contract";
import {
	findJustCompletedPlans,
	listPlanMemberCards,
	resolvePlanAcceptanceCommand,
	resolvePlanFailureSurfaceCardId,
} from "../../../src/core/plan-integration-gate";

const COLUMN_IDS = ["backlog", "planning", "in_progress", "review", "completed", "trash"] as const;

type ColumnId = (typeof COLUMN_IDS)[number];

interface CardSpec {
	id: string;
	column: ColumnId;
	prompt?: string;
	plan?: { planSlug: string; sourceTaskId?: string | null };
}

function makeCard(spec: CardSpec): RuntimeBoardCard {
	return {
		id: spec.id,
		title: spec.id,
		prompt: spec.prompt ?? `Do ${spec.id}.`,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 2,
		...(spec.plan
			? {
					generatedFromPlan: {
						artifactKind: "decomposition" as const,
						planSlug: spec.plan.planSlug,
						planTaskId: `${spec.plan.planSlug}::${spec.id}`,
						sourceTaskId: spec.plan.sourceTaskId ?? null,
					},
				}
			: {}),
	};
}

function makeBoard(cards: CardSpec[]): RuntimeBoardData {
	return {
		columns: COLUMN_IDS.map((id) => ({
			id,
			title: id,
			cards: cards.filter((card) => card.column === id).map(makeCard),
		})),
		dependencies: [],
	};
}

describe("findJustCompletedPlans", () => {
	it("returns the plan slug when the completed card was the last non-terminal member", () => {
		const board = makeBoard([
			{ id: "a", column: "completed", plan: { planSlug: "auth" } },
			{ id: "b", column: "completed", plan: { planSlug: "auth" } },
		]);
		expect(findJustCompletedPlans({ board, completedTaskId: "b" })).toEqual(["auth"]);
	});

	it("returns [] while a plan sibling straggler is still in a working lane", () => {
		for (const stragglerLane of ["backlog", "planning", "in_progress", "review"] as const) {
			const board = makeBoard([
				{ id: "a", column: "completed", plan: { planSlug: "auth" } },
				{ id: "b", column: stragglerLane, plan: { planSlug: "auth" } },
			]);
			expect(findJustCompletedPlans({ board, completedTaskId: "a" })).toEqual([]);
		}
	});

	it("returns [] for a completed card that is not part of any plan", () => {
		const board = makeBoard([{ id: "solo", column: "completed" }]);
		expect(findJustCompletedPlans({ board, completedTaskId: "solo" })).toEqual([]);
	});

	it("returns [] when the named card is not (yet) in the completed lane", () => {
		const board = makeBoard([{ id: "a", column: "review", plan: { planSlug: "auth" } }]);
		expect(findJustCompletedPlans({ board, completedTaskId: "a" })).toEqual([]);
	});

	it("returns [] for an unknown task id", () => {
		const board = makeBoard([{ id: "a", column: "completed", plan: { planSlug: "auth" } }]);
		expect(findJustCompletedPlans({ board, completedTaskId: "ghost" })).toEqual([]);
	});

	it("excludes trashed members from membership (a trashed sibling neither blocks nor counts)", () => {
		const board = makeBoard([
			{ id: "a", column: "completed", plan: { planSlug: "auth" } },
			{ id: "b", column: "trash", plan: { planSlug: "auth" } },
		]);
		expect(findJustCompletedPlans({ board, completedTaskId: "a" })).toEqual(["auth"]);
	});

	it("scopes membership to the completed card's own plan slug", () => {
		const board = makeBoard([
			{ id: "a", column: "completed", plan: { planSlug: "auth" } },
			{ id: "x", column: "in_progress", plan: { planSlug: "billing" } },
		]);
		expect(findJustCompletedPlans({ board, completedTaskId: "a" })).toEqual(["auth"]);
	});
});

describe("resolvePlanAcceptanceCommand", () => {
	it("picks the most common Acceptance check: command across the plan's member cards", () => {
		const board = makeBoard([
			{
				id: "a",
				column: "completed",
				plan: { planSlug: "auth" },
				prompt: "Build login.\n\nAcceptance check: npm run test:fast",
			},
			{
				id: "b",
				column: "completed",
				plan: { planSlug: "auth" },
				prompt: "Build logout.\n\nAcceptance check: npm run test:fast",
			},
			{
				id: "c",
				column: "completed",
				plan: { planSlug: "auth" },
				prompt: "Build session store.\n\nAcceptance check: npm run build",
			},
		]);
		expect(resolvePlanAcceptanceCommand({ board, planSlug: "auth" })).toBe("npm run test:fast");
	});

	it("breaks ties toward the command seen first in board scan order", () => {
		const board = makeBoard([
			{
				id: "a",
				column: "completed",
				plan: { planSlug: "auth" },
				prompt: "First.\n\nAcceptance check: npm run build",
			},
			{
				id: "b",
				column: "completed",
				plan: { planSlug: "auth" },
				prompt: "Second.\n\nAcceptance check: npm run test:fast",
			},
		]);
		expect(resolvePlanAcceptanceCommand({ board, planSlug: "auth" })).toBe("npm run build");
	});

	it("returns null when no member card carries an acceptance command", () => {
		const board = makeBoard([
			{ id: "a", column: "completed", plan: { planSlug: "auth" }, prompt: "No check here." },
			{ id: "b", column: "completed", plan: { planSlug: "auth" }, prompt: "None here either." },
		]);
		expect(resolvePlanAcceptanceCommand({ board, planSlug: "auth" })).toBeNull();
	});

	it("ignores trashed members' commands (excluded from membership)", () => {
		const board = makeBoard([
			{
				id: "a",
				column: "completed",
				plan: { planSlug: "auth" },
				prompt: "Live.\n\nAcceptance check: npm run test:fast",
			},
			{
				id: "b",
				column: "trash",
				plan: { planSlug: "auth" },
				prompt: "Dead.\n\nAcceptance check: rm -rf everything",
			},
			{
				id: "c",
				column: "trash",
				plan: { planSlug: "auth" },
				prompt: "Dead too.\n\nAcceptance check: rm -rf everything",
			},
		]);
		expect(resolvePlanAcceptanceCommand({ board, planSlug: "auth" })).toBe("npm run test:fast");
	});

	it("extracts a command embedded mid-prompt and trims it", () => {
		const board = makeBoard([
			{
				id: "a",
				column: "completed",
				plan: { planSlug: "auth" },
				prompt: "Intro line.\nAcceptance check:   npx vitest run test/auth  \nTrailing prose.",
			},
		]);
		expect(resolvePlanAcceptanceCommand({ board, planSlug: "auth" })).toBe("npx vitest run test/auth");
	});
});

describe("resolvePlanFailureSurfaceCardId", () => {
	it("prefers the plan's source (decompose) card when it is still on the board", () => {
		const board = makeBoard([
			{ id: "decompose-1", column: "completed" },
			{ id: "a", column: "completed", plan: { planSlug: "auth", sourceTaskId: "decompose-1" } },
			{ id: "b", column: "completed", plan: { planSlug: "auth", sourceTaskId: "decompose-1" } },
		]);
		expect(resolvePlanFailureSurfaceCardId(board, "auth")).toBe("decompose-1");
	});

	it("falls back to the first member card when the source card is gone", () => {
		const board = makeBoard([
			{ id: "a", column: "completed", plan: { planSlug: "auth", sourceTaskId: "decompose-1" } },
			{ id: "b", column: "completed", plan: { planSlug: "auth", sourceTaskId: "decompose-1" } },
		]);
		expect(resolvePlanFailureSurfaceCardId(board, "auth")).toBe("a");
	});

	it("falls back to the first member card when the source card sits in trash", () => {
		const board = makeBoard([
			{ id: "decompose-1", column: "trash" },
			{ id: "a", column: "completed", plan: { planSlug: "auth", sourceTaskId: "decompose-1" } },
		]);
		expect(resolvePlanFailureSurfaceCardId(board, "auth")).toBe("a");
	});

	it("returns null when the plan has no members left on the board", () => {
		const board = makeBoard([{ id: "unrelated", column: "completed" }]);
		expect(resolvePlanFailureSurfaceCardId(board, "auth")).toBeNull();
	});
});

describe("listPlanMemberCards", () => {
	it("lists non-trash members in board scan order", () => {
		const board = makeBoard([
			{ id: "later", column: "completed", plan: { planSlug: "auth" } },
			{ id: "early", column: "in_progress", plan: { planSlug: "auth" } },
			{ id: "gone", column: "trash", plan: { planSlug: "auth" } },
			{ id: "other", column: "in_progress", plan: { planSlug: "billing" } },
		]);
		expect(listPlanMemberCards(board, "auth").map((card) => card.id)).toEqual(["early", "later"]);
	});
});
