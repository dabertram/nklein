import { describe, expect, it } from "vitest";
import { createBoardReadTools } from "../../../src/chat/chat-board-tools";
import type { RuntimeBoardColumnId, RuntimeBoardData } from "../../../src/core/api-contract";

function board(
	columns: Array<{ id: RuntimeBoardColumnId; title: string; cards: Array<{ id: string; title?: string }> }>,
): RuntimeBoardData {
	return {
		columns: columns.map((column) => ({
			id: column.id,
			title: column.title,
			cards: column.cards.map((card) => ({
				id: card.id,
				title: card.title ?? "",
				prompt: "",
				startInPlanMode: false,
				baseRef: "main",
				createdAt: 1,
				updatedAt: 1,
			})),
		})),
		dependencies: [],
	};
}

function getBoardTool(loadBoard: (projectPath: string) => Promise<RuntimeBoardData>) {
	const { tools } = createBoardReadTools("/proj", { deps: { loadBoard } });
	const tool = tools.find((candidate) => candidate.name === "get_board");
	if (!tool) {
		throw new Error("get_board tool missing");
	}
	return tool;
}

describe("createBoardReadTools — get_board", () => {
	it("is a sandbox_read action (always allowed by the execution-mode gate)", () => {
		const { tools } = createBoardReadTools("/proj");
		expect(tools[0]?.actionKind).toBe("sandbox_read");
	});

	it("summarizes every column with its card ids and titles", async () => {
		const tool = getBoardTool(async () =>
			board([
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						{ id: "c1", title: "Add login" },
						{ id: "c2", title: "Fix bug" },
					],
				},
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [{ id: "c3", title: "Build API" }] },
			]),
		);
		const out = await tool.run({});
		expect(out).toContain("Backlog (2): [c1] Add login · [c2] Fix bug");
		expect(out).toContain("Planning (0): —");
		expect(out).toContain("In Progress (1): [c3] Build API");
		expect(out).toContain("3 card(s) across 3 columns");
	});

	it("reports an empty board distinctly", async () => {
		const tool = getBoardTool(async () => board([{ id: "backlog", title: "Backlog", cards: [] }]));
		expect(await tool.run({})).toBe("The board has no cards yet (all columns are empty).");
	});

	it("falls back to (untitled) for a card with a blank title", async () => {
		const tool = getBoardTool(async () =>
			board([{ id: "backlog", title: "Backlog", cards: [{ id: "c1", title: "  " }] }]),
		);
		expect(await tool.run({})).toContain("[c1] (untitled)");
	});

	it("returns a safe message — never a host path — when the board cannot be read", async () => {
		const tool = getBoardTool(async () => {
			throw new Error("/private/var/folders/secret/board.json boom");
		});
		const out = await tool.run({});
		expect(out).toBe("Could not read the project board.");
		expect(out).not.toContain("/private/var");
	});

	it("does not leak the project path into the tool definition shown to the model", () => {
		const { definitions } = createBoardReadTools("/private/var/secret-proj");
		expect(JSON.stringify(definitions)).not.toContain("secret-proj");
		expect(definitions[0]?.name).toBe("get_board");
	});
});
