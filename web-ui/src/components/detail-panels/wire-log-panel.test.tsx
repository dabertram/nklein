import type { ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WireLogPanel } from "@/components/detail-panels/wire-log-panel";

const fetchTaskWireLogMock = vi.hoisted(() => vi.fn());
vi.mock("@/runtime/queries/task-control", () => ({
	fetchTaskWireLog: fetchTaskWireLogMock,
}));

function render(root: Root, element: ReactElement): void {
	root.render(element);
}

function openPanel(container: HTMLDivElement): void {
	const toggle = container.querySelector("button");
	if (!toggle) {
		throw new Error("panel toggle not rendered");
	}
	toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("WireLogPanel (§dsh#31)", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		fetchTaskWireLogMock.mockReset();
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	});

	it("loads on open and renders request sizes, truncation, and inspected sessions", async () => {
		fetchTaskWireLogMock.mockResolvedValue({
			sessionIds: ["task-1", "task-1::review"],
			requests: [
				{
					recordedAt: "2026-08-22T00:00:00.000Z",
					source: "sdk_model_wrapper",
					purpose: "session_turn",
					modelId: "qwen3.8-27b-mlx",
					messagesSha256: "abc",
					messageCount: 6,
					totalChars: 43_855,
					toolNames: ["read_files", "decompose_project"],
					systemPromptChars: 12_000,
					messages: [{ role: "user", chars: 43_855 }],
				},
			],
			injections: [],
			requestLogDisabled: false,
			injectionLogDisabled: false,
			truncatedRequests: 3,
			truncatedInjections: 0,
		});
		await act(async () => {
			render(root, <WireLogPanel workspaceId="ws-1" taskId="task-1" />);
		});
		await act(async () => {
			openPanel(container);
		});
		expect(fetchTaskWireLogMock).toHaveBeenCalledWith("ws-1", "task-1", false);
		expect(container.textContent).toContain("session_turn");
		expect(container.textContent).toContain("43.9k ch");
		expect(container.textContent).toContain("3 older truncated");
		expect(container.textContent).toContain("task-1::review");
	});

	it("says DISABLED, never empty, when request logging is off", async () => {
		fetchTaskWireLogMock.mockResolvedValue({
			sessionIds: ["task-1"],
			requests: [],
			injections: [],
			requestLogDisabled: true,
			injectionLogDisabled: true,
			truncatedRequests: 0,
			truncatedInjections: 0,
		});
		await act(async () => {
			render(root, <WireLogPanel workspaceId="ws-1" taskId="task-1" />);
		});
		await act(async () => {
			openPanel(container);
		});
		expect(container.textContent).toContain("Request logging is switched off");
		expect(container.textContent).not.toContain("No recorded requests");
	});

	it("shows the honest failure state when the endpoint is unreachable", async () => {
		fetchTaskWireLogMock.mockRejectedValue(new Error("no such procedure"));
		await act(async () => {
			render(root, <WireLogPanel workspaceId="ws-1" taskId="task-1" />);
		});
		await act(async () => {
			openPanel(container);
		});
		expect(container.textContent).toContain("Could not load the wire log");
	});
});
