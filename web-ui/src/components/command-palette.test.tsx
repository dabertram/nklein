import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandPalette } from "@/components/command-palette";

function getButton(container: HTMLElement, label: string): HTMLButtonElement {
	const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === label);
	if (!(button instanceof HTMLButtonElement)) {
		throw new Error(`Expected button ${label}.`);
	}
	return button;
}

describe("CommandPalette", () => {
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

	it("runs a selected command and closes the palette", () => {
		const onOpenChange = vi.fn();
		const onCreateTask = vi.fn();
		act(() => {
			root.render(
				<CommandPalette
					open
					onOpenChange={onOpenChange}
					hasProject
					showDebugCommands
					onCreateTask={onCreateTask}
					onAddProject={() => {}}
					onOpenSettings={() => {}}
					onOpenDebugTools={() => {}}
					onToggleGitHistory={() => {}}
					onStartAllTasks={() => {}}
				/>,
			);
		});

		act(() => {
			getButton(document.body, "New task").click();
		});

		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(onCreateTask).toHaveBeenCalledTimes(1);
		expect(document.body.textContent).toContain("Developer Tools");
	});

	it("disables project-only commands when no project is open", () => {
		act(() => {
			root.render(
				<CommandPalette
					open
					onOpenChange={() => {}}
					hasProject={false}
					showDebugCommands={false}
					onCreateTask={() => {}}
					onAddProject={() => {}}
					onOpenSettings={() => {}}
					onToggleGitHistory={() => {}}
					onStartAllTasks={() => {}}
				/>,
			);
		});

		expect(getButton(document.body, "New task").disabled).toBe(true);
		expect(getButton(document.body, "Toggle git history").disabled).toBe(true);
		expect(getButton(document.body, "Start all backlog tasks").disabled).toBe(true);
		expect(getButton(document.body, "Add project").disabled).toBe(false);
		expect(document.body.textContent).not.toContain("Developer Tools");
	});
});
