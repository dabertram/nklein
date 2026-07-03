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

	async function expand(blockedKind?: "agent_sandbox_unavailable" | "needs_decomposition"): Promise<void> {
		await act(async () => {
			root.render(<TaskEscalationPanel workspaceId="ws" taskId="t1" blockedKind={blockedKind} />);
			await Promise.resolve();
		});
		await act(async () => {
			container.querySelector("button")?.click(); // the "What was tried" toggle
			await Promise.resolve();
			await Promise.resolve();
		});
	}

	/** A hard-stuck escalation report (3 trailing failures across distinct approaches incl. an uncleared loop). */
	function hardStuckReport() {
		const row = (rung: number, approach: string, outcome: string) => ({
			rung,
			modelId: "m1",
			approach,
			outcome,
			qualityScore: null,
			qualityOk: null,
			salvage: null,
			recordedAt: rung,
		});
		return {
			taskId: "t1",
			totalAttempts: 3,
			modelsTried: ["m1"],
			finalOutcome: "other_failure",
			attempts: [row(0, "endpoint:e1", "loop"), row(1, "endpoint:e2", "loop"), row(2, "prompt:p1", "other_failure")],
		};
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

	it("shows a hard-stuck verdict and the get-through-the-wall suggestions (§5.AB)", async () => {
		fetchTaskEscalationMock.mockResolvedValue(hardStuckReport());
		await expand();
		expect(container.textContent).toContain("hard_stuck");
		expect(container.textContent).toContain("Options to get through the wall");
		expect(container.textContent).toContain("Clarify the goal");
		expect(container.textContent).toContain("Make a more capable model available");
	});

	it("promotes 'Fix the environment' to the front when the card is sandbox-blocked (§5.AG)", async () => {
		fetchTaskEscalationMock.mockResolvedValue(hardStuckReport());
		await expand("agent_sandbox_unavailable");
		const items = Array.from(container.querySelectorAll("li")).map((li) => li.textContent);
		expect(items[0]).toBe("Fix the environment");
		// the full set still shows — promotion only reorders.
		expect(items).toContain("Clarify the goal");
	});

	it("does not promote fix-environment for a non-environment blocker (needs_decomposition)", async () => {
		fetchTaskEscalationMock.mockResolvedValue(hardStuckReport());
		await expand("needs_decomposition");
		const items = Array.from(container.querySelectorAll("li")).map((li) => li.textContent);
		// default order leads with "Clarify the goal"; fix-environment stays in its default (non-front) slot.
		expect(items[0]).toBe("Clarify the goal");
		expect(items).toContain("Fix the environment");
	});
});
