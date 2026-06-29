import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useDocumentVisibility } from "./use-document-visibility";

let container: HTMLDivElement;
let root: Root;
let latest: boolean;

function Probe(): null {
	latest = useDocumentVisibility();
	return null;
}

function setVisibility(state: "visible" | "hidden"): void {
	Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
	act(() => {
		document.dispatchEvent(new Event("visibilitychange"));
	});
}

describe("useDocumentVisibility", () => {
	beforeEach(() => {
		container = document.createElement("div");
		root = createRoot(container);
	});
	afterEach(() => {
		act(() => root.unmount());
	});

	it("reflects the initial visibility and updates on visibilitychange events", () => {
		Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
		act(() => root.render(<Probe />));
		expect(latest).toBe(true);

		setVisibility("hidden");
		expect(latest).toBe(false);

		setVisibility("visible");
		expect(latest).toBe(true);
	});
});
