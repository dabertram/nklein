import { describe, expect, it } from "vitest";
import { KANBAN_TASK_TOOL_CARDS, kanbanTaskToolCardByName } from "../../../src/core/task-tool-cards";
import { renderToolCard, renderToolCardList } from "../../../src/core/tool-card";
import { createKanbanToolPolicies } from "../../../src/nklein-agent/nklein-runtime-setup";

describe("KANBAN_TASK_TOOL_CARDS", () => {
	// THE invariant: exactly one card per tool !Klein offers via createKanbanToolPolicies(). Adding or removing a kanban
	// tool without authoring/removing its card fails here — "one card per existing tool" (§5.O) stays true by construction.
	it("covers exactly the createKanbanToolPolicies() enabled tool set", () => {
		const policyToolNames = new Set(
			Object.entries(createKanbanToolPolicies())
				.filter(([, policy]) => policy?.enabled !== false)
				.map(([name]) => name),
		);
		const cardNames = new Set(KANBAN_TASK_TOOL_CARDS.map((card) => card.name));
		expect(cardNames).toEqual(policyToolNames);
	});

	it("has a unique name per card", () => {
		const names = KANBAN_TASK_TOOL_CARDS.map((card) => card.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it("gives every card the required fields (non-empty name/purpose/useWhen)", () => {
		for (const card of KANBAN_TASK_TOOL_CARDS) {
			expect(card.name.length).toBeGreaterThan(0);
			expect(card.purpose.trim().length).toBeGreaterThan(0);
			expect(card.useWhen.trim().length).toBeGreaterThan(0);
		}
	});

	it("uses conventional tool names (lowercase snake_case, no spaces)", () => {
		for (const card of KANBAN_TASK_TOOL_CARDS) {
			expect(card.name).toMatch(/^[a-z][a-z0-9_]*$/);
		}
	});

	it("renders each card's name in the compact list", () => {
		const rendered = renderToolCardList(KANBAN_TASK_TOOL_CARDS);
		for (const card of KANBAN_TASK_TOOL_CARDS) {
			expect(rendered).toContain(card.name);
		}
		// Token-frugal: the list is far smaller than the tools' verbose native schemas would be.
		expect(rendered.length).toBeGreaterThan(0);
	});

	it("keeps each card terse (a real narrowing vs a verbose schema)", () => {
		for (const card of KANBAN_TASK_TOOL_CARDS) {
			// A card should be a short block, not a schema dump — a soft ceiling that flags accidental bloat.
			expect(renderToolCard(card).length).toBeLessThan(400);
		}
	});
});

describe("kanbanTaskToolCardByName", () => {
	it("returns the matching card for a known tool", () => {
		const card = kanbanTaskToolCardByName("read_files");
		expect(card?.name).toBe("read_files");
		expect(card?.purpose.length).toBeGreaterThan(0);
	});

	it("returns undefined for an unknown tool name", () => {
		expect(kanbanTaskToolCardByName("no_such_tool")).toBeUndefined();
	});
});
