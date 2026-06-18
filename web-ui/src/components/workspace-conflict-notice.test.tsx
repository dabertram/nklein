import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceConflictNotice } from "@/components/workspace-conflict-notice";

describe("WorkspaceConflictNotice", () => {
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

	it("renders recovery guidance and calls handlers", async () => {
		const onDismiss = vi.fn();
		const onRefresh = vi.fn();
		const onRestoreLocalEdit = vi.fn();

		await act(async () => {
			root.render(
				<WorkspaceConflictNotice
					onDismiss={onDismiss}
					onRefresh={onRefresh}
					onRestoreLocalEdit={onRestoreLocalEdit}
				/>,
			);
		});

		expect(container.textContent).toContain("Board changed elsewhere");
		expect(container.textContent).toContain("could not be safely replayed automatically");
		expect(container.textContent).toContain("Restore my edit");

		const buttons = Array.from(container.querySelectorAll("button"));
		const restoreButton = buttons.find((button) => button.textContent?.includes("Restore my edit"));
		const refreshButton = buttons.find((button) => button.textContent?.includes("Refresh board"));
		const dismissButton = buttons.find((button) => button.textContent?.includes("Dismiss"));
		const iconDismissButton = container.querySelector(
			'button[aria-label="Dismiss workspace conflict notice"]',
		) as HTMLButtonElement | null;

		expect(restoreButton).toBeTruthy();
		expect(refreshButton).toBeTruthy();
		expect(dismissButton).toBeTruthy();
		expect(iconDismissButton).toBeTruthy();

		await act(async () => {
			restoreButton?.click();
		});
		expect(onRestoreLocalEdit).toHaveBeenCalledTimes(1);

		await act(async () => {
			refreshButton?.click();
		});
		expect(onRefresh).toHaveBeenCalledTimes(1);

		await act(async () => {
			dismissButton?.click();
		});
		expect(onDismiss).toHaveBeenCalledTimes(1);

		await act(async () => {
			iconDismissButton?.click();
		});
		expect(onDismiss).toHaveBeenCalledTimes(2);
	});
});
