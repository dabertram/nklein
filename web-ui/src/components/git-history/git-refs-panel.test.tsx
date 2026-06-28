import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitRefsPanel } from "@/components/git-history/git-refs-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RuntimeGitRef } from "@/runtime/types";

const refs: RuntimeGitRef[] = [
	{ name: "main", type: "branch", hash: "aaa", isHead: true },
	{ name: "feature/x", type: "branch", hash: "bbb", isHead: false },
];

describe("GitRefsPanel", () => {
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
		vi.restoreAllMocks();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("renders an explicit switch button on non-HEAD local branches that checks them out on click", async () => {
		const onCheckoutRef = vi.fn();
		const onSelectRef = vi.fn();

		await act(async () => {
			root.render(
				<TooltipProvider>
					<GitRefsPanel
						refs={refs}
						selectedRefName="main"
						isLoading={false}
						errorMessage={null}
						panelWidth={240}
						workingCopyChanges={null}
						onSelectRef={onSelectRef}
						onCheckoutRef={onCheckoutRef}
					/>
				</TooltipProvider>,
			);
		});

		// The HEAD branch has no switch affordance (you can't check out the branch you're already on).
		expect(container.querySelector('[aria-label="Switch to main"]')).toBeNull();

		const switchButton = container.querySelector('[aria-label="Switch to feature/x"]');
		expect(switchButton).toBeInstanceOf(HTMLButtonElement);
		if (!(switchButton instanceof HTMLButtonElement)) {
			throw new Error("Expected a switch button for the non-HEAD branch.");
		}

		await act(async () => {
			switchButton.click();
		});

		expect(onCheckoutRef).toHaveBeenCalledTimes(1);
		expect(onCheckoutRef).toHaveBeenCalledWith("feature/x");
		// Clicking the dedicated switch button must not also trigger a plain ref selection.
		expect(onSelectRef).not.toHaveBeenCalled();
	});

	it("omits the switch button when no checkout handler is provided", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<GitRefsPanel
						refs={refs}
						selectedRefName="main"
						isLoading={false}
						errorMessage={null}
						panelWidth={240}
						workingCopyChanges={null}
						onSelectRef={() => {}}
					/>
				</TooltipProvider>,
			);
		});

		expect(container.querySelector('[aria-label="Switch to feature/x"]')).toBeNull();
	});
});
