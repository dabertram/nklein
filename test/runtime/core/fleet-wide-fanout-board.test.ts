import { describe, expect, it } from "vitest";
import { createFleetWideFanoutBoard } from "../../../src/core/fleet-wide-fanout-board";

describe("createFleetWideFanoutBoard", () => {
	it("builds six independent leaves and exactly two join levels", () => {
		const board = createFleetWideFanoutBoard({ baseRef: "main", now: 10 });
		const cards = board.columns.flatMap((column) => column.cards);
		const formatterIds = cards
			.filter(
				(card) =>
					card.id.startsWith("formatter-") && !["formatter-registry", "formatter-integration"].includes(card.id),
			)
			.map((card) => card.id);

		expect(cards).toHaveLength(8);
		expect(formatterIds).toHaveLength(6);
		for (const formatterId of formatterIds) {
			expect(board.dependencies.some((dependency) => dependency.fromTaskId === formatterId)).toBe(false);
			expect(board.dependencies).toContainEqual(
				expect.objectContaining({ fromTaskId: "formatter-registry", toTaskId: formatterId }),
			);
		}
		expect(board.dependencies).toContainEqual(
			expect.objectContaining({ fromTaskId: "formatter-integration", toTaskId: "formatter-registry" }),
		);
	});

	it("gives every worker a disjoint scoped contract and executable acceptance command", () => {
		const cards = createFleetWideFanoutBoard({ baseRef: "trunk", now: 20 }).columns.flatMap((column) => column.cards);
		const ownedPaths = new Set<string>();
		for (const card of cards) {
			expect(card.baseRef).toBe("trunk");
			expect(card.prompt).toContain("Acceptance command: npm test");
			// Honest provenance (audit 2026-08-12): a plain plan-internal planTaskId (no `::` composite) and a null
			// sourceTaskId — the fixture is not decomposed from a real board card.
			expect(card.generatedFromPlan).toMatchObject({
				artifactKind: "decomposition",
				planSlug: "fleet-wide-fanout-proof",
				planTaskId: card.id,
				sourceTaskId: null,
			});
			expect(card.generatedFromPlan?.planTaskId).not.toContain("::");
			for (const path of card.writeScope ?? []) {
				expect(ownedPaths.has(path)).toBe(false);
				ownedPaths.add(path);
			}
		}
	});
});
