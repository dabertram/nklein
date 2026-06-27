import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConcurrencyEditor } from "@/components/concurrency-editor";

function setInputValue(el: HTMLInputElement, value: string): void {
	const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
	setter?.call(el, value);
	el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ConcurrencyEditor", () => {
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

	it("renders existing per-provider and per-model entries", () => {
		act(() =>
			root.render(
				<ConcurrencyEditor perProvider={{ lmstudio: 2 }} perModel={{ "lmstudio:m:e": 1 }} onChange={() => {}} />,
			),
		);
		expect(container.textContent).toContain("lmstudio");
		expect(container.textContent).toContain("lmstudio:m:e");
		expect(container.querySelector<HTMLInputElement>('[aria-label="lmstudio concurrency cap"]')?.value).toBe("2");
	});

	it("removes a provider entry", () => {
		const onChange = vi.fn();
		act(() => root.render(<ConcurrencyEditor perProvider={{ lmstudio: 2 }} perModel={{}} onChange={onChange} />));
		act(() => container.querySelector<HTMLButtonElement>('[aria-label="Remove lmstudio cap"]')?.click());
		expect(onChange).toHaveBeenCalledWith({ perProvider: {}, perModel: {} });
	});

	it("edits a provider cap", () => {
		const onChange = vi.fn();
		act(() => root.render(<ConcurrencyEditor perProvider={{ lmstudio: 2 }} perModel={{}} onChange={onChange} />));
		const input = container.querySelector<HTMLInputElement>('[aria-label="lmstudio concurrency cap"]');
		if (input) {
			act(() => setInputValue(input, "5"));
		}
		expect(onChange).toHaveBeenCalledWith({ perProvider: { lmstudio: 5 }, perModel: {} });
	});

	it("adds a new provider cap from the add-row", () => {
		const onChange = vi.fn();
		act(() => root.render(<ConcurrencyEditor perProvider={{}} perModel={{}} onChange={onChange} />));
		const keyInput = container.querySelector<HTMLInputElement>('[aria-label="New provider key"]');
		const capInput = container.querySelector<HTMLInputElement>('[aria-label="New provider cap"]');
		if (keyInput && capInput) {
			act(() => setInputValue(keyInput, "ollama"));
			act(() => setInputValue(capInput, "4"));
			act(() => container.querySelector<HTMLButtonElement>('[aria-label="Add provider cap"]')?.click());
		}
		expect(onChange).toHaveBeenCalledWith({ perProvider: { ollama: 4 }, perModel: {} });
	});
});
