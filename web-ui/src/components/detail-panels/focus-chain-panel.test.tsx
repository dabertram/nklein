import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardCard, BoardColumn, CardSelection } from "@/types";

const queryMocks = vi.hoisted(() => ({
	fetchTaskFocusChainHistory: vi.fn(),
}));
vi.mock("@/runtime/queries/task-control", () => queryMocks);

import { FocusChainPanel } from "@/components/detail-panels/focus-chain-panel";

function createSelection(focusChain: BoardCard["focusChain"]): CardSelection {
	const card: BoardCard = {
		id: "task-1",
		title: "Task 1",
		prompt: "Task 1",
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
		focusChain,
	};
	const column: BoardColumn = { id: "in_progress", title: "In Progress", cards: [card] };
	return { card, column, allColumns: [column] };
}

describe("FocusChainPanel (F1.6 current step + audit history)", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		queryMocks.fetchTaskFocusChainHistory.mockReset();
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
			previousActEnvironment;
	});

	async function render(selection: CardSelection, workspaceId?: string | null): Promise<void> {
		await act(async () => {
			root.render(<FocusChainPanel selection={selection} workspaceId={workspaceId} />);
		});
	}

	it("marks the canonical current step (first in_progress) with a chip", async () => {
		await render(
			createSelection({
				steps: [
					{ text: "done step", status: "done" },
					{ text: "active step", status: "in_progress" },
					{ text: "next step", status: "pending" },
				],
				updatedAt: 1,
			}),
		);
		const items = [...container.querySelectorAll("li")];
		const active = items.find((item) => item.textContent?.includes("active step"));
		expect(active?.textContent).toContain("current");
		const pending = items.find((item) => item.textContent?.includes("next step"));
		expect(pending?.textContent).not.toContain("current");
	});

	it("loads and renders the ledger history on toggle; hides the toggle without a workspaceId", async () => {
		queryMocks.fetchTaskFocusChainHistory.mockResolvedValue({
			transitions: [
				{ stepText: "active step", from: null, to: "in_progress", recordedAt: 1_000 },
				{ stepText: "active step", from: "in_progress", to: "done", recordedAt: 2_000 },
			],
		});
		const selection = createSelection({ steps: [{ text: "active step", status: "in_progress" }], updatedAt: 1 });
		await render(selection, "ws-1");
		const toggle = container.querySelector('[data-testid="focus-chain-history-toggle"]') as HTMLButtonElement;
		expect(toggle).not.toBeNull();
		expect(queryMocks.fetchTaskFocusChainHistory).not.toHaveBeenCalled(); // lazy — only on demand
		await act(async () => {
			toggle.click();
		});
		expect(queryMocks.fetchTaskFocusChainHistory).toHaveBeenCalledWith("ws-1", "task-1");
		const history = container.querySelector('[data-testid="focus-chain-history"]');
		expect(history?.textContent).toContain("active step: new → in_progress");
		expect(history?.textContent).toContain("active step: in_progress → done");

		// Without a workspace id there is no history affordance at all.
		await render(selection, null);
		expect(container.querySelector('[data-testid="focus-chain-history-toggle"]')).toBeNull();
	});

	it("shows an empty-history placeholder when the ledger has no focus transitions", async () => {
		queryMocks.fetchTaskFocusChainHistory.mockResolvedValue({ transitions: [] });
		await render(createSelection({ steps: [{ text: "a", status: "pending" }], updatedAt: 1 }), "ws-1");
		const toggle = container.querySelector('[data-testid="focus-chain-history-toggle"]') as HTMLButtonElement;
		await act(async () => {
			toggle.click();
		});
		expect(container.querySelector('[data-testid="focus-chain-history"]')?.textContent).toContain(
			"No recorded transitions yet.",
		);
	});
});
