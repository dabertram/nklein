import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type UseSetupWizardResult, useSetupWizard } from "@/hooks/use-setup-wizard";
import type { RuntimeSetupPlanResponse } from "@/runtime/types";

const fetchGlobalSetupPlanMock = vi.hoisted(() => vi.fn());
const fetchProjectSetupPlanMock = vi.hoisted(() => vi.fn());
const saveRuntimeConfigMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/runtime-config-query", () => ({
	fetchGlobalSetupPlan: fetchGlobalSetupPlanMock,
	fetchProjectSetupPlan: fetchProjectSetupPlanMock,
	saveRuntimeConfig: saveRuntimeConfigMock,
}));

function globalPlan(completedAt: number | null): RuntimeSetupPlanResponse {
	return {
		kind: "global",
		steps: [
			{ stepId: "provider", title: "Provider", recommendation: "Use local", detail: "d" },
			{ stepId: "sandbox", title: "Sandbox", recommendation: "Docker", detail: "d" },
		],
		completedAt,
	};
}

function projectPlan(completedAt: number | null): RuntimeSetupPlanResponse {
	return {
		kind: "project",
		steps: [{ stepId: "overrides", title: "Overrides", recommendation: "Inherit", detail: "d" }],
		completedAt,
	};
}

type HookSnapshot = UseSetupWizardResult;

function HookHarness({
	kind,
	workspaceId,
	enabled,
	autoFireSuppressed,
	onSnapshot,
}: {
	kind: "global" | "project";
	workspaceId: string | null;
	enabled: boolean;
	autoFireSuppressed?: boolean;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const snapshot = useSetupWizard({ kind, workspaceId, enabled, autoFireSuppressed });
	useEffect(() => {
		onSnapshot(snapshot);
	}, [onSnapshot, snapshot]);
	return null;
}

function flushPromises(): Promise<void> {
	return act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

describe("useSetupWizard", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		fetchGlobalSetupPlanMock.mockReset();
		fetchProjectSetupPlanMock.mockReset();
		saveRuntimeConfigMock.mockReset();
		saveRuntimeConfigMock.mockResolvedValue({});
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	async function mount(props: Omit<React.ComponentProps<typeof HookHarness>, "onSnapshot">): Promise<{
		latest: () => HookSnapshot;
	}> {
		let latestSnapshot: HookSnapshot | null = null;
		await act(async () => {
			root.render(<HookHarness {...props} onSnapshot={(snapshot) => (latestSnapshot = snapshot)} />);
			await Promise.resolve();
		});
		await flushPromises();
		return {
			latest: () => {
				if (latestSnapshot === null) {
					throw new Error("Expected a setup wizard snapshot.");
				}
				return latestSnapshot;
			},
		};
	}

	it("auto-fires the global wizard when the plan has never been completed", async () => {
		fetchGlobalSetupPlanMock.mockResolvedValue(globalPlan(null));
		const { latest } = await mount({ kind: "global", workspaceId: null, enabled: true });
		expect(latest().isOpen).toBe(true);
		expect(latest().wouldAutoFire).toBe(true);
		expect(latest().steps).toHaveLength(2);
	});

	it("does NOT auto-fire when the plan is already completed", async () => {
		fetchGlobalSetupPlanMock.mockResolvedValue(globalPlan(1_700_000_000_000));
		const { latest } = await mount({ kind: "global", workspaceId: null, enabled: true });
		expect(latest().isOpen).toBe(false);
		expect(latest().wouldAutoFire).toBe(false);
		expect(latest().completedAt).toBe(1_700_000_000_000);
	});

	it("does NOT auto-fire the project wizard until enabled (a project is active)", async () => {
		fetchProjectSetupPlanMock.mockResolvedValue(projectPlan(null));
		const { latest } = await mount({ kind: "project", workspaceId: null, enabled: false });
		expect(fetchProjectSetupPlanMock).not.toHaveBeenCalled();
		expect(latest().isOpen).toBe(false);
	});

	it("suppresses auto-fire (for precedence) but still reports wouldAutoFire", async () => {
		fetchGlobalSetupPlanMock.mockResolvedValue(globalPlan(null));
		const { latest } = await mount({
			kind: "global",
			workspaceId: null,
			enabled: true,
			autoFireSuppressed: true,
		});
		expect(latest().wouldAutoFire).toBe(true);
		expect(latest().isOpen).toBe(false);
	});

	it("skip closes the wizard for the session", async () => {
		fetchGlobalSetupPlanMock.mockResolvedValue(globalPlan(null));
		const { latest } = await mount({ kind: "global", workspaceId: null, enabled: true });
		expect(latest().isOpen).toBe(true);
		await act(async () => {
			latest().skip();
			await Promise.resolve();
		});
		expect(latest().isOpen).toBe(false);
	});

	it("complete writes the GLOBAL stamp via saveRuntimeConfig then closes", async () => {
		fetchGlobalSetupPlanMock.mockResolvedValue(globalPlan(null));
		const { latest } = await mount({ kind: "global", workspaceId: "ws-1", enabled: true });
		await act(async () => {
			await latest().complete();
		});
		expect(saveRuntimeConfigMock).toHaveBeenCalledTimes(1);
		expect(saveRuntimeConfigMock).toHaveBeenCalledWith("ws-1", {
			setupWizardCompletedAt: expect.any(Number),
		});
		expect(latest().isOpen).toBe(false);
	});

	it("complete writes the PROJECT stamp for the project wizard", async () => {
		fetchProjectSetupPlanMock.mockResolvedValue(projectPlan(null));
		const { latest } = await mount({ kind: "project", workspaceId: "ws-2", enabled: true });
		await act(async () => {
			await latest().complete();
		});
		expect(saveRuntimeConfigMock).toHaveBeenCalledWith("ws-2", {
			projectSetupWizardCompletedAt: expect.any(Number),
		});
	});

	it("open() force-opens even after a completed plan would keep it closed", async () => {
		fetchGlobalSetupPlanMock.mockResolvedValue(globalPlan(1_700_000_000_000));
		const { latest } = await mount({ kind: "global", workspaceId: null, enabled: true });
		expect(latest().isOpen).toBe(false);
		await act(async () => {
			latest().open();
			await Promise.resolve();
		});
		expect(latest().isOpen).toBe(true);
	});
});
