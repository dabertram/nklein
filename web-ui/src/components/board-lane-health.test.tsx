import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BoardLaneHealth } from "@/components/board-lane-health";
import type { BoardCard, BoardColumn, BoardColumnId, TaskBlockedKind } from "@/types";

function card(id: string, blockedKind?: TaskBlockedKind): BoardCard {
	return {
		id,
		title: id,
		prompt: `p ${id}`,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 2,
		...(blockedKind ? { blockedKind } : {}),
	} as BoardCard;
}

function column(id: BoardColumnId, cards: BoardCard[]): BoardColumn {
	return { id, title: id, cards };
}

describe("BoardLaneHealth", () => {
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

	it("shows risky + stuck counts for a lane that needs attention", () => {
		act(() =>
			root.render(
				<BoardLaneHealth
					column={column("in_progress", [
						card("sandbox", "agent_sandbox_unavailable"), // risky
						card("decomp", "needs_decomposition"), // stuck
						card("fine"), // idle → healthy, not shown
					])}
					taskSessions={{}}
				/>,
			),
		);
		expect(container.querySelector('[aria-label="Lane attention"]')).not.toBeNull();
		expect(container.querySelector('[title="1 risky"]')).not.toBeNull();
		expect(container.querySelector('[title="1 stuck"]')).not.toBeNull();
	});

	it("renders nothing when a lane has no risky/stuck cards", () => {
		act(() =>
			root.render(<BoardLaneHealth column={column("in_progress", [card("a"), card("b")])} taskSessions={{}} />),
		);
		expect(container.textContent).toBe("");
	});

	it("renders nothing for the trash lane (excluded from health)", () => {
		act(() =>
			root.render(
				<BoardLaneHealth column={column("trash", [card("x", "agent_sandbox_unavailable")])} taskSessions={{}} />,
			),
		);
		expect(container.textContent).toBe("");
	});
});
