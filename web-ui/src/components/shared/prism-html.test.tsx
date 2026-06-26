import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PrismHtml } from "@/components/shared/prism-html";

describe("PrismHtml", () => {
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

	it("injects html as real markup into a <span> host by default and applies the className", () => {
		act(() => {
			root.render(<PrismHtml html={'<span class="token">x</span>'} className="font-mono" />);
		});
		const host = container.firstElementChild as HTMLElement;
		expect(host.tagName).toBe("SPAN");
		expect(host.className).toBe("font-mono");
		// The inner <span> was injected as markup (not escaped text), proving the sink is wired through.
		expect(host.querySelector("span.token")?.textContent).toBe("x");
	});

	it("renders a <code> host when as='code'", () => {
		act(() => {
			root.render(<PrismHtml as="code" html="plain" />);
		});
		const host = container.firstElementChild as HTMLElement;
		expect(host.tagName).toBe("CODE");
		expect(host.textContent).toBe("plain");
	});
});
