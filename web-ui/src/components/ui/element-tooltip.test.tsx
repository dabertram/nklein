import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ElementTooltip } from "@/components/ui/element-tooltip";
import { ELEMENT_TOOLTIPS } from "@/components/ui/element-tooltips";
import { TooltipProvider } from "@/components/ui/tooltip";

describe("ELEMENT_TOOLTIPS registry", () => {
	it("gives every element a non-empty name and description", () => {
		const entries = Object.entries(ELEMENT_TOOLTIPS);
		expect(entries.length).toBeGreaterThan(0);
		for (const [id, copy] of entries) {
			expect(copy.name.trim().length, `${id} name`).toBeGreaterThan(0);
			expect(copy.description.trim().length, `${id} description`).toBeGreaterThan(0);
		}
	});
});

describe("ElementTooltip", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it("renders its trigger child", () => {
		act(() => {
			root.render(
				<TooltipProvider>
					<ElementTooltip id="top-bar.settings">
						<button type="button">Settings</button>
					</ElementTooltip>
				</TooltipProvider>,
			);
		});
		const button = container.querySelector("button");
		expect(button?.textContent).toBe("Settings");
	});
});
