import type { RuntimeBoardCard, RuntimeBoardData } from "@runtime-contract";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BoardHealthSummary } from "@/components/board-health-summary";

function card(id: string): RuntimeBoardCard {
	return {
		id,
		title: id,
		prompt: `prompt ${id}`,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 2,
	} as RuntimeBoardCard;
}

function board(cardsByColumn: Array<{ columnId: string; card: RuntimeBoardCard }>): RuntimeBoardData {
	const columnIds = ["backlog", "planning", "in_progress", "review", "completed", "trash"] as const;
	return {
		columns: columnIds.map((id) => ({
			id,
			title: id,
			cards: cardsByColumn.filter((entry) => entry.columnId === id).map((entry) => entry.card),
		})),
		dependencies: [],
	};
}

describe("BoardHealthSummary", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	function render(node: React.ReactNode): void {
		act(() => root.render(node));
	}

	it("renders nothing for a null board or an empty board", () => {
		render(<BoardHealthSummary board={null} taskSessions={{}} />);
		expect(container.textContent).toBe("");
		render(<BoardHealthSummary board={board([])} taskSessions={{}} />);
		expect(container.textContent).toBe("");
	});

	it("shows per-state counts derived from the board (idle in_progress = healthy, completed = done)", () => {
		render(
			<BoardHealthSummary
				board={board([
					{ columnId: "in_progress", card: card("a") },
					{ columnId: "in_progress", card: card("b") },
					{ columnId: "completed", card: card("c") },
				])}
				taskSessions={{}}
			/>,
		);
		const group = container.querySelector('[aria-label="Board health"]');
		expect(group).not.toBeNull();
		expect(container.querySelector('[title="2 healthy"]')).not.toBeNull();
		expect(container.querySelector('[title="1 done"]')).not.toBeNull();
		// No risky/inbox without overrides.
		expect(container.querySelector('[title="0 risky"]')).toBeNull();
	});

	it("surfaces risky + the inbox count when off-summary overrides flag a card", () => {
		render(
			<BoardHealthSummary
				board={board([{ columnId: "in_progress", card: card("gated") }])}
				taskSessions={{}}
				resolveOverrides={(taskId) => (taskId === "gated" ? { deliveryGateHeld: true } : {})}
			/>,
		);
		expect(container.querySelector('[title="1 risky"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="needs-you-chip"]')).not.toBeNull();
	});
});
