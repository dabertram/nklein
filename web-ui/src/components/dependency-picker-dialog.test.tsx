import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DependencyPickerDialog } from "@/components/dependency-picker-dialog";
import type { BoardDependency } from "@/types/board";

/** Set a native <select>'s value and dispatch the change event React listens for. */
function setSelectValue(select: HTMLSelectElement, value: string): void {
	const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
	setter?.call(select, value);
	select.dispatchEvent(new Event("change", { bubbles: true }));
}

function getSelect(): HTMLSelectElement {
	const select = document.querySelector('[data-testid="dependency-picker-select"]');
	if (!(select instanceof HTMLSelectElement)) {
		throw new Error("dependency-picker-select was not rendered.");
	}
	return select;
}

const card = { id: "card-a", title: "Card A" };
const allCards = [
	{ id: "card-a", title: "Card A", columnTitle: "Backlog" },
	{ id: "card-b", title: "Card B", columnTitle: "Backlog" },
	{ id: "card-c", title: "Card C", columnTitle: "In Progress" },
];
const dependencies: BoardDependency[] = [{ id: "dep-1", fromTaskId: "card-a", toTaskId: "card-c", createdAt: 1 }];

describe("DependencyPickerDialog", () => {
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

	function render(overrides: Partial<React.ComponentProps<typeof DependencyPickerDialog>> = {}): {
		onCreateDependency: ReturnType<typeof vi.fn>;
		onDeleteDependency: ReturnType<typeof vi.fn>;
	} {
		const onCreateDependency = vi.fn();
		const onDeleteDependency = vi.fn();
		act(() => {
			root.render(
				<DependencyPickerDialog
					open={true}
					onOpenChange={() => {}}
					card={card}
					allCards={allCards}
					dependencies={dependencies}
					onCreateDependency={onCreateDependency}
					onDeleteDependency={onDeleteDependency}
					{...overrides}
				/>,
			);
		});
		return { onCreateDependency, onDeleteDependency };
	}

	it("lists candidates excluding the managed card and already-linked cards", () => {
		render();
		const optionValues = Array.from(getSelect().options).map((option) => option.value);
		expect(optionValues).toContain("card-b"); // an unlinked other card
		expect(optionValues).not.toContain("card-a"); // self
		expect(optionValues).not.toContain("card-c"); // already linked
	});

	it("creates a link with the managed card as the dependent (first arg)", () => {
		const { onCreateDependency } = render();
		act(() => {
			setSelectValue(getSelect(), "card-b");
		});
		const addButton = document.querySelector('[data-testid="dependency-picker-add"]');
		if (!(addButton instanceof HTMLButtonElement)) {
			throw new Error("dependency-picker-add was not rendered.");
		}
		act(() => {
			addButton.click();
		});
		expect(onCreateDependency).toHaveBeenCalledWith("card-a", "card-b");
	});

	it("shows current links and removes them on click", () => {
		const { onDeleteDependency } = render();
		expect(document.body.textContent).toContain("waits on");
		expect(document.body.textContent).toContain("Card C");
		const removeButton = document.querySelector('[data-testid="dependency-picker-remove-dep-1"]');
		if (!(removeButton instanceof HTMLButtonElement)) {
			throw new Error("dependency-picker-remove-dep-1 was not rendered.");
		}
		act(() => {
			removeButton.click();
		});
		expect(onDeleteDependency).toHaveBeenCalledWith("dep-1");
	});

	it("disables the link control when there are no candidates", () => {
		render({ allCards: [{ id: "card-a", title: "Card A", columnTitle: "Backlog" }] }); // only the managed card
		expect(getSelect().disabled).toBe(true);
		expect(document.body.textContent).toContain("No other tasks to link");
	});
});
