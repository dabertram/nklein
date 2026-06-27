import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchTaskEscalationMock = vi.hoisted(() => vi.fn());
vi.mock("@/runtime/runtime-config-query", () => ({ fetchTaskEscalation: fetchTaskEscalationMock }));

import { TaskEscalationPanel } from "@/components/detail-panels/task-escalation-panel";

describe("TaskEscalationPanel", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		fetchTaskEscalationMock.mockReset();
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	async function expand(): Promise<void> {
		await act(async () => {
			root.render(<TaskEscalationPanel workspaceId="ws" taskId="t1" />);
			await Promise.resolve();
		});
		await act(async () => {
			container.querySelector("button")?.click(); // the "What was tried" toggle
			await Promise.resolve();
			await Promise.resolve();
		});
	}

	it("renders the attempt chain when expanded", async () => {
		fetchTaskEscalationMock.mockResolvedValue({
			taskId: "t1",
			totalAttempts: 2,
			modelsTried: ["m1", "m2"],
			finalOutcome: "success",
			attempts: [
				{
					rung: 0,
					modelId: "m1",
					approach: "default",
					outcome: "no_tool_call",
					qualityScore: null,
					qualityOk: null,
					salvage: null,
					recordedAt: 1,
				},
				{
					rung: 1,
					modelId: "m2",
					approach: "endpoint:native",
					outcome: "success",
					qualityScore: 0.9,
					qualityOk: true,
					salvage: null,
					recordedAt: 2,
				},
			],
		});
		await expand();
		expect(fetchTaskEscalationMock).toHaveBeenCalledWith("ws", "t1");
		expect(container.textContent).toContain("m1");
		expect(container.textContent).toContain("endpoint:native");
		expect(container.textContent).toContain("success");
		expect(container.textContent).toContain("2 attempts");
	});

	it("shows a no-escalation note for a card with no recorded attempts", async () => {
		fetchTaskEscalationMock.mockResolvedValue({
			taskId: "t1",
			totalAttempts: 0,
			modelsTried: [],
			finalOutcome: null,
			attempts: [],
		});
		await expand();
		expect(container.textContent).toContain("not escalated");
	});
});
