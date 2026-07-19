import type { ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardEffortPanel } from "@/components/detail-panels/card-effort-panel";

const fetchCardEffortMock = vi.hoisted(() => vi.fn());
vi.mock("@/runtime/queries/task-control", () => ({
	fetchCardEffort: fetchCardEffortMock,
}));

function render(root: Root, element: ReactElement): void {
	root.render(element);
}

describe("CardEffortPanel (F12.58)", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		fetchCardEffortMock.mockReset();
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	});

	it("loads on open and renders tokens, honesty counter, and board total", async () => {
		fetchCardEffortMock.mockResolvedValue({
			card: {
				runs: 3,
				totalTokens: 482_000,
				promptTokens: 400_000,
				completionTokens: 82_000,
				untrackedRuns: 1,
				wallMs: 900_000,
			},
			boardTotalTokens: 1_200_000,
			boardWallMs: 5_400_000,
			boardUntrackedRuns: 1,
		});
		await act(async () => {
			render(root, <CardEffortPanel workspaceId="ws-1" taskId="task-1" />);
		});
		expect(container.textContent).toContain("Cost meter");
		expect(fetchCardEffortMock).not.toHaveBeenCalled();
		const toggle = container.querySelector("button");
		expect(toggle).not.toBeNull();
		await act(async () => {
			toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(fetchCardEffortMock).toHaveBeenCalledWith("ws-1", "task-1");
		expect(container.textContent).toContain("482.0k");
		expect(container.textContent).toContain("15.0m");
		expect(container.textContent).toContain("without token");
		expect(container.textContent).toContain("Board total");
		expect(container.textContent).toContain("1.2M");
	});

	it("shows the honest failure state when the endpoint is unreachable", async () => {
		fetchCardEffortMock.mockRejectedValue(new Error("legacy runtime"));
		await act(async () => {
			render(root, <CardEffortPanel workspaceId="ws-1" taskId="task-1" />);
		});
		const toggle = container.querySelector("button");
		await act(async () => {
			toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(container.textContent).toContain("Could not load effort");
	});
});
