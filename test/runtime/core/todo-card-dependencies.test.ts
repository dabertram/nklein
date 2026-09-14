import { describe, expect, it } from "vitest";
import type { RuntimeBoardData } from "../../../src/core/api-contract";
import {
	applyDeclaredTodoDependencies,
	declaredTodoDependencyId,
	parseTodoCardDependencyDeclarations,
} from "../../../src/core/todo-card-dependencies";

/**
 * F2.36 (b). Dependencies between open backlog items come ONLY from an explicit `*(depends on: …)*` declaration —
 * a mention is not a dependency (P25.3 and P23.5 cite each other; inferring edges from references cycles on the
 * first pass). Every declaration passes the board's cycle guard, and every refusal is reported.
 */
function board(dependencies: RuntimeBoardData["dependencies"] = []): RuntimeBoardData {
	return { columns: [], dependencies } as unknown as RuntimeBoardData;
}
const item = (itemId: string, text: string) => ({ cardId: `todo:${itemId}`, itemId, text });

describe("parseTodoCardDependencyDeclarations", () => {
	it("reads only the explicit marker — a mention is not a declaration", () => {
		expect(parseTodoCardDependencyDeclarations("P15.5 — Settings-surface reduction driven by P15.3.")).toEqual([]);
		expect(
			parseTodoCardDependencyDeclarations("…shrinks as proof accumulates. *(depends on: P15.3, F3.41)* More text."),
		).toEqual(["P15.3", "F3.41"]);
	});

	it("accepts commas or spaces, strips emphasis and trailing punctuation, and deduplicates across markers", () => {
		expect(
			parseTodoCardDependencyDeclarations("*(depends on: P1.A **P1.B**, P1.A.)* and *(depends on: N8)*"),
		).toEqual(["P1.A", "P1.B", "N8"]);
		expect(parseTodoCardDependencyDeclarations("*(depends on: )*")).toEqual([]);
	});

	it("accepts only the backlog's item-id shapes — prose that shows the marker declares nothing", () => {
		expect(parseTodoCardDependencyDeclarations("an entry declares `*(depends on: ID, ID)*`")).toEqual([]);
		expect(parseTodoCardDependencyDeclarations("*(depends on: P0.POOLLOSS, P21.6b, F2.36, N8, §5.AB, foo)*")).toEqual(
			["P0.POOLLOSS", "P21.6b", "F2.36", "N8", "§5.AB"],
		);
	});
});

describe("applyDeclaredTodoDependencies", () => {
	it("adds a declared edge with the mechanism's own id, and reports it", () => {
		const plan = applyDeclaredTodoDependencies({
			board: board(),
			items: [item("P15.3", "campaign"), item("P15.5", "reduction *(depends on: P15.3)*")],
			nowMs: 1_000,
		});
		expect(plan.added).toEqual([{ dependent: "todo:P15.5", prerequisite: "todo:P15.3" }]);
		expect(plan.board.dependencies).toEqual([
			{
				id: declaredTodoDependencyId("todo:P15.5", "todo:P15.3"),
				fromTaskId: "todo:P15.5",
				toTaskId: "todo:P15.3",
				createdAt: 1_000,
			},
		]);
		expect([...plan.dependentsWithEdges]).toEqual(["todo:P15.5"]);
		expect(plan.refused).toEqual([]);
	});

	it("REFUSES the edge that would close a cycle and says so — the first declaration wins", () => {
		const plan = applyDeclaredTodoDependencies({
			board: board(),
			items: [item("P25.3", "*(depends on: P23.5)*"), item("P23.5", "*(depends on: P25.3)*")],
			nowMs: 1,
		});
		expect(plan.added).toEqual([{ dependent: "todo:P25.3", prerequisite: "todo:P23.5" }]);
		expect(plan.refused).toEqual([{ dependent: "todo:P23.5", declared: "P25.3", reason: "would_create_cycle" }]);
		// A longer loop through an edge that already exists on the board is refused the same way.
		const viaExisting = applyDeclaredTodoDependencies({
			board: board([{ id: "manual", fromTaskId: "todo:P1.B", toTaskId: "todo:P1.C", createdAt: 0 }]),
			items: [item("P1.A", "*(depends on: P1.B)*"), item("P1.B", ""), item("P1.C", "*(depends on: P1.A)*")],
			nowMs: 1,
		});
		expect(viaExisting.added).toEqual([{ dependent: "todo:P1.A", prerequisite: "todo:P1.B" }]);
		expect(viaExisting.refused.map((refusal) => refusal.reason)).toEqual(["would_create_cycle"]);
	});

	it("reports an unknown item, a self-reference, and a shipped prerequisite (satisfied, no edge)", () => {
		const plan = applyDeclaredTodoDependencies({
			board: board(),
			items: [item("P1.X", "*(depends on: P1.X, P9.GONE, P0.SHIPPED)*")],
			isShipped: (id) => id === "P0.SHIPPED",
			nowMs: 1,
		});
		expect(plan.added).toEqual([]);
		expect(plan.refused).toEqual([
			{ dependent: "todo:P1.X", declared: "P1.X", reason: "self" },
			{ dependent: "todo:P1.X", declared: "P9.GONE", reason: "unknown_item" },
		]);
		expect(plan.satisfied).toEqual([{ dependent: "todo:P1.X", declared: "P0.SHIPPED" }]);
		expect(plan.dependentsWithEdges.size).toBe(0);
	});

	it("keeps a still-declared edge, removes a withdrawn one, and never touches edges it did not create", () => {
		const existing = board([
			{
				id: declaredTodoDependencyId("todo:P1.A", "todo:P1.B"),
				fromTaskId: "todo:P1.A",
				toTaskId: "todo:P1.B",
				createdAt: 5,
			},
			{
				id: declaredTodoDependencyId("todo:P1.A", "todo:P1.C"),
				fromTaskId: "todo:P1.A",
				toTaskId: "todo:P1.C",
				createdAt: 5,
			},
			{ id: "self:todo:P1.A->done:spine", fromTaskId: "todo:P1.A", toTaskId: "done:spine", createdAt: 5 },
		]);
		const plan = applyDeclaredTodoDependencies({
			board: existing,
			items: [item("P1.A", "*(depends on: P1.B)*"), item("P1.B", ""), item("P1.C", "")],
			nowMs: 9,
		});
		expect(plan.kept).toEqual([{ dependent: "todo:P1.A", prerequisite: "todo:P1.B" }]);
		expect(plan.removed).toEqual([{ dependent: "todo:P1.A", prerequisite: "todo:P1.C" }]);
		expect(plan.added).toEqual([]);
		expect(plan.board.dependencies.map((edge) => edge.id)).toEqual([
			declaredTodoDependencyId("todo:P1.A", "todo:P1.B"),
			"self:todo:P1.A->done:spine",
		]);
		expect([...plan.dependentsWithEdges]).toEqual(["todo:P1.A"]);
	});
});
