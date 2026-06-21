import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DebugDialog } from "@/components/debug-dialog";

describe("DebugDialog", () => {
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
		document.body.innerHTML = "";
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("shows and opens the !Klein data directory when available", () => {
		const handleOpenDataDirectory = vi.fn();

		act(() => {
			root.render(
				<DebugDialog
					open={true}
					onOpenChange={() => {}}
					isResetAllStatePending={false}
					dataDirectoryPath={"/Users/david/.nklein/nklein"}
					onOpenDataDirectory={handleOpenDataDirectory}
					onShowStartupOnboardingDialog={() => {}}
					onResetAllState={() => {}}
				/>,
			);
		});

		expect(document.body.textContent).toContain("Open data directory");
		expect(document.body.textContent).toContain("/Users/david/.nklein/nklein");

		const button = Array.from(document.body.querySelectorAll("button")).find(
			(candidate) => candidate.textContent?.trim() === "Open data dir",
		);
		if (!(button instanceof HTMLButtonElement)) {
			throw new Error("Open data dir button was not rendered.");
		}

		act(() => {
			button.click();
		});

		expect(handleOpenDataDirectory).toHaveBeenCalledTimes(1);
	});

	it("disables the data directory action when the path is unavailable", () => {
		act(() => {
			root.render(
				<DebugDialog
					open={true}
					onOpenChange={() => {}}
					isResetAllStatePending={false}
					dataDirectoryPath={null}
					onOpenDataDirectory={() => {}}
					onShowStartupOnboardingDialog={() => {}}
					onResetAllState={() => {}}
				/>,
			);
		});

		const button = Array.from(document.body.querySelectorAll("button")).find(
			(candidate) => candidate.textContent?.trim() === "Open data dir",
		);
		if (!(button instanceof HTMLButtonElement)) {
			throw new Error("Open data dir button was not rendered.");
		}

		expect(button.disabled).toBe(true);
	});
});
