import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMocks = vi.hoisted(() => ({
	fetchTaskActionTrail: vi.fn(),
}));
vi.mock("@/runtime/queries/task-control", () => queryMocks);

import { ActionTrailPanel } from "@/components/detail-panels/action-trail-panel";

describe("ActionTrailPanel (F12.55)", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		queryMocks.fetchTaskActionTrail.mockReset();
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

	const openPanel = async (): Promise<void> => {
		await act(async () => {
			root.render(<ActionTrailPanel workspaceId="w1" taskId="task-1" />);
		});
		const toggle = container.querySelector("button");
		await act(async () => {
			toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
	};

	it("loads on open and renders entries with reversibility labels + hypothesis framing (never as evidence)", async () => {
		queryMocks.fetchTaskActionTrail.mockResolvedValue({
			entries: [
				{
					at: 1_784_000_000_000,
					kind: "action",
					text: "Edited src/auth.ts",
					files: ["src/auth.ts"],
					reversibility: "reversible",
					hypothesis: "add token refresh",
				},
				{
					at: 1_784_000_100_000,
					kind: "action",
					text: "Pushed the branch",
					files: [],
					reversibility: "irreversible",
					hypothesis: null,
				},
			],
			totalEntries: 140,
		});
		await openPanel();
		expect(queryMocks.fetchTaskActionTrail).toHaveBeenCalledWith("w1", "task-1");
		expect(container.textContent).toContain("Edited src/auth.ts");
		expect(container.textContent).toContain("IRREVERSIBLE");
		expect(container.textContent).toContain("working hypothesis: add token refresh");
		expect(container.textContent).toContain("not");
		expect(container.textContent).toContain("Showing the latest 2 of 140 entries");
	});

	it("distinguishes an empty trail from a FAILED load — an unreachable endpoint never reads as inactivity", async () => {
		queryMocks.fetchTaskActionTrail.mockResolvedValue({ entries: [], totalEntries: 0 });
		await openPanel();
		expect(container.textContent).toContain("No ledgered activity");

		// Fresh mount for the failure case — the open/loaded state must not leak between scenarios.
		await act(async () => {
			root.unmount();
		});
		root = createRoot(container);
		queryMocks.fetchTaskActionTrail.mockRejectedValue(new Error("404"));
		await openPanel();
		expect(container.textContent).toContain("Could not load the trail");
	});
});
