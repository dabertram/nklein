import { DEFAULT_RUNTIME_MEMORY_FRESHNESS_AUDIT } from "@runtime-contract";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryAuditSettingsPanel } from "@/components/memory-audit-settings-panel";
import { memoryAuditToInputs } from "@/components/runtime-settings-memory-audit";

const fetchMemoryAuditMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/runtime-config-query", () => ({
	fetchMemoryAudit: fetchMemoryAuditMock,
}));

const retainedStatus = {
	generatedAt: 1_700_000_000_000,
	enabled: true,
	paused: false,
	lastAuditAt: 1_700_000_000_000,
	nextAuditAt: 1_700_604_800_000,
	state: "findings" as const,
	available: true,
	notesAudited: 12,
	summary: { stale: 2, orphaned: 1, broken_link: 3, duplicate_title: 0 },
	topFindings: [{ kind: "broken_link" as const, noteTitle: "Routing lesson", detail: "Missing target" }],
};

describe("MemoryAuditSettingsPanel retained status", () => {
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
		fetchMemoryAuditMock.mockReset().mockResolvedValue(retainedStatus);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
			previousActEnvironment;
	});

	it("loads the retained snapshot once and surfaces cadence, counts, and bounded findings", async () => {
		await act(async () => {
			root.render(
				<MemoryAuditSettingsPanel
					value={memoryAuditToInputs(DEFAULT_RUNTIME_MEMORY_FRESHNESS_AUDIT)}
					onChange={vi.fn()}
					workspaceId="workspace-1"
				/>,
			);
			await Promise.resolve();
		});

		expect(fetchMemoryAuditMock).toHaveBeenCalledTimes(1);
		expect(fetchMemoryAuditMock).toHaveBeenCalledWith("workspace-1");
		const text = container.textContent ?? "";
		expect(text).toContain("Findings need review");
		expect(text).toContain("12 note(s) audited");
		expect(text).toContain("3 broken link(s)");
		expect(text).toContain("Routing lesson");
		expect(text).toContain("Missing target");
	});

	it("refreshes only on explicit request after the initial read", async () => {
		await act(async () => {
			root.render(
				<MemoryAuditSettingsPanel
					value={memoryAuditToInputs(DEFAULT_RUNTIME_MEMORY_FRESHNESS_AUDIT)}
					onChange={vi.fn()}
					workspaceId="workspace-1"
				/>,
			);
			await Promise.resolve();
		});
		const refresh = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Refresh status",
		);
		expect(refresh).toBeDefined();
		await act(async () => {
			refresh?.click();
			await Promise.resolve();
		});
		expect(fetchMemoryAuditMock).toHaveBeenCalledTimes(2);
	});
});
