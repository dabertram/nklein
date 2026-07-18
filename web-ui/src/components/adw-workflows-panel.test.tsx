import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdwWorkflowsPanel } from "@/components/adw-workflows-panel";

const listQuery = vi.fn();
const startMutate = vi.fn();
const statusQuery = vi.fn();

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: {
			listAdwWorkflows: { query: listQuery },
			startAdwRun: { mutate: startMutate },
			getAdwRunStatus: { query: statusQuery },
		},
	}),
}));

function flush() {
	// Fake timers are active — drive both the microtask queue and any zero-delay timers.
	return act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
}

describe("AdwWorkflowsPanel (F12.107)", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		listQuery.mockReset();
		startMutate.mockReset();
		statusQuery.mockReset();
		vi.useFakeTimers();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		vi.useRealTimers();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("lists workflows and shows the empty-state hint when none exist", async () => {
		listQuery.mockResolvedValue({ ok: true, workflows: [] });
		act(() => {
			root.render(<AdwWorkflowsPanel workspaceId="ws-1" />);
		});
		await flush();
		expect(document.body.textContent).toContain("No workflows defined");
	});

	it("runs a workflow and polls per-step status to a PASS verdict", async () => {
		listQuery.mockResolvedValue({
			ok: true,
			workflows: [
				{ name: "smoke", description: "Smoke", stepCount: 2, agentStepCount: 0, invalid: null },
				{ name: "broken", description: null, stepCount: 0, agentStepCount: 0, invalid: "bad json" },
			],
		});
		startMutate.mockResolvedValue({ ok: true, runId: "adw-smoke-1", error: null });
		statusQuery.mockResolvedValue({
			ok: true,
			run: {
				runId: "adw-smoke-1",
				name: "smoke",
				input: "",
				startedAt: 1,
				finishedAt: 2,
				verdict: "pass",
				steps: [
					{ id: "greet", kind: "deterministic", status: "ok", detail: "exit 0", cardId: null },
					{ id: "chain", kind: "deterministic", status: "ok", detail: "exit 0", cardId: null },
				],
				evidenceDir: "/tmp/e",
				error: null,
			},
		});
		act(() => {
			root.render(<AdwWorkflowsPanel workspaceId="ws-1" />);
		});
		await flush();
		const runButton = Array.from(document.body.querySelectorAll("button")).find(
			(candidate) => candidate.getAttribute("aria-label") === "Run workflow smoke",
		);
		if (!(runButton instanceof HTMLButtonElement)) {
			throw new Error("Expected the smoke run button.");
		}
		// The invalid workflow's button is disabled.
		const brokenButton = Array.from(document.body.querySelectorAll("button")).find(
			(candidate) => candidate.getAttribute("aria-label") === "Run workflow broken",
		);
		expect((brokenButton as HTMLButtonElement | undefined)?.disabled).toBe(true);
		act(() => {
			runButton.click();
		});
		await flush();
		expect(startMutate).toHaveBeenCalledWith({ name: "smoke", input: "" });
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3_100);
		});
		await flush();
		expect(statusQuery).toHaveBeenCalledWith({ runId: "adw-smoke-1" });
		expect(document.body.textContent).toContain("PASS");
		expect(document.body.textContent).toContain("greet");
	});
});
