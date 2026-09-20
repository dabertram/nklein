import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { Dialog, DialogHeader } from "@/components/ui/dialog";

describe("Dialog accessibility wiring", () => {
	let container: HTMLDivElement;
	let root: Root;
	let warn: MockInstance<(...data: unknown[]) => void>;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		warn.mockRestore();
	});

	function dialogElement(): HTMLElement {
		const element = document.querySelector<HTMLElement>("[role='dialog']");
		if (!element) throw new Error("dialog not rendered");
		return element;
	}

	it("renders a hidden Radix description and lets Radix wire aria-describedby to it", () => {
		act(() => {
			root.render(
				<Dialog open onOpenChange={() => {}} description="Pick a project folder.">
					<DialogHeader title="Add Project" />
				</Dialog>,
			);
		});
		const dialog = dialogElement();
		const describedBy = dialog.getAttribute("aria-describedby");
		expect(describedBy).toBeTruthy();
		expect(document.getElementById(describedBy ?? "")?.textContent).toBe("Pick a project folder.");
		// Radix's production-time a11y warning must not fire for a described dialog.
		expect(warn.mock.calls.some((call) => String(call[0]).includes("Missing `Description`"))).toBe(false);
	});

	it("omits aria-describedby entirely when no description is given (no Radix warning)", () => {
		act(() => {
			root.render(
				<Dialog open onOpenChange={() => {}}>
					<DialogHeader title="Command Palette" />
				</Dialog>,
			);
		});
		expect(dialogElement().hasAttribute("aria-describedby")).toBe(false);
		expect(warn.mock.calls.some((call) => String(call[0]).includes("Missing `Description`"))).toBe(false);
	});

	it("hides the built-in close control when the caller renders its own", () => {
		act(() => {
			root.render(
				<Dialog open onOpenChange={() => {}}>
					<DialogHeader title="Get started" hideCloseButton>
						<button type="button" aria-label="Skip the tour" />
					</DialogHeader>
				</Dialog>,
			);
		});
		expect(dialogElement().querySelectorAll("button").length).toBe(1);
	});
});
