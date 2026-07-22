import { act, createElement, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	resolveOnboardingAgentIds,
	TaskStartAgentOnboardingCarousel,
} from "@/components/task-start-agent-onboarding-carousel";
import type { UseRuntimeSettingsNKleinControllerResult } from "@/hooks/use-runtime-settings-nklein-controller";

const useRuntimeSettingsNKleinControllerMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-runtime-settings-nklein-controller", () => ({
	useRuntimeSettingsNKleinController: useRuntimeSettingsNKleinControllerMock,
}));

afterEach(() => {
	useRuntimeSettingsNKleinControllerMock.mockReset();
});

describe("resolveOnboardingAgentIds", () => {
	it("lists only local NKlein when cloud providers are disabled", () => {
		expect(resolveOnboardingAgentIds(false)).toEqual(["nklein"]);
	});

	it("keeps all onboarding agents when cloud providers are enabled", () => {
		expect(resolveOnboardingAgentIds(true)).toEqual(["nklein"]);
	});

	it("registers the Done action once when a parent state update re-renders a fresh controller aggregate", async () => {
		const saveProviderSettings = vi.fn().mockResolvedValue({ ok: true });
		useRuntimeSettingsNKleinControllerMock.mockImplementation(
			() =>
				({
					providerCatalog: [],
					providerModels: [],
					providerId: "lmstudio",
					modelId: "",
					baseUrl: "http://127.0.0.1:1234/v1",
					reasoningEffort: "",
					hasUnsavedChanges: false,
					isLoadingProviderModels: false,
					saveProviderSettings,
				}) as unknown as UseRuntimeSettingsNKleinControllerResult,
		);
		const publishDoneAction = vi.fn();
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

		function Harness() {
			const [, setDoneAction] = useState<(() => Promise<{ ok: boolean; message?: string }>) | null>(null);
			const handleDoneActionChange = useCallback(
				(action: (() => Promise<{ ok: boolean; message?: string }>) | null) => {
					publishDoneAction(action);
					setDoneAction(() => action);
				},
				[],
			);
			return createElement(TaskStartAgentOnboardingCarousel, {
				open: true,
				workspaceId: null,
				runtimeConfig: null,
				selectedAgentId: "nklein",
				agents: [],
				nkleinProviderSettings: null,
				activeSlideIndex: 0,
				onDoneActionChange: handleDoneActionChange,
			});
		}

		try {
			await act(async () => {
				root.render(createElement(Harness));
				await Promise.resolve();
			});
			expect(publishDoneAction).toHaveBeenCalledTimes(1);
			expect(useRuntimeSettingsNKleinControllerMock.mock.calls.length).toBeGreaterThanOrEqual(2);
		} finally {
			act(() => root.unmount());
			container.remove();
			if (previousActEnvironment === undefined) {
				delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
			} else {
				(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
					previousActEnvironment;
			}
		}
	});
});
