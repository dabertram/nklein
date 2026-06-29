import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKanbanAccessGate } from "./use-kanban-access-gate";

const mocks = vi.hoisted(() => ({
	fetchNKleinKanbanAccess: vi.fn<(workspaceId: string | null) => Promise<{ enabled: boolean }>>(),
}));

vi.mock("@/runtime/runtime-config-query", () => ({
	fetchNKleinKanbanAccess: mocks.fetchNKleinKanbanAccess,
}));

describe("useKanbanAccessGate", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnv: boolean | undefined;

	beforeEach(() => {
		mocks.fetchNKleinKanbanAccess.mockReset();
		container = document.createElement("div");
		root = createRoot(container);
		previousActEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	});
	afterEach(() => {
		act(() => root.unmount());
		vi.restoreAllMocks();
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnv;
	});

	let latest: { isBlocked: boolean; refresh: () => void } | null;
	function Probe(): null {
		latest = useKanbanAccessGate({ workspaceId: "ws" });
		return null;
	}

	async function render(): Promise<void> {
		await act(async () => {
			root.render(<Probe />);
			await Promise.resolve();
			await Promise.resolve();
		});
	}

	it("blocks when access is disabled, allows when enabled", async () => {
		mocks.fetchNKleinKanbanAccess.mockResolvedValue({ enabled: false });
		await render();
		expect(latest?.isBlocked).toBe(true);
	});

	it("does not block when access is enabled", async () => {
		mocks.fetchNKleinKanbanAccess.mockResolvedValue({ enabled: true });
		await render();
		expect(latest?.isBlocked).toBe(false);
	});

	it("treats a fetch error as not-blocked (fail-open)", async () => {
		mocks.fetchNKleinKanbanAccess.mockRejectedValue(new Error("network"));
		await render();
		expect(latest?.isBlocked).toBe(false);
	});

	it("re-checks on refresh()", async () => {
		mocks.fetchNKleinKanbanAccess.mockResolvedValue({ enabled: true });
		await render();
		expect(latest?.isBlocked).toBe(false);
		mocks.fetchNKleinKanbanAccess.mockResolvedValue({ enabled: false });
		await act(async () => {
			latest?.refresh();
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(latest?.isBlocked).toBe(true);
	});
});
