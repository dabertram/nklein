import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScrollAnchor } from "./use-scroll-anchor";

/**
 * U1b — the measurable acceptance for scroll anchoring.
 *
 * ⚠️ **SCOPE, STATED HONESTLY: jsdom performs NO LAYOUT.** `getBoundingClientRect` returns zeroes, so a test
 * here cannot prove the chat "does not jump" in a browser. What it CAN prove is the arithmetic and the control
 * flow: which element is chosen as the anchor, the sign and magnitude of the correction, and that the hook stays
 * inert when pinned. Those are where the regressions live — an anchor chosen wrongly or a correction applied with
 * the wrong sign both produce exactly the reported symptom.
 *
 * Rects are simulated so the hook sees a plausible layout. **A test that mocked the hook's own output would prove
 * nothing**; these mocks describe the DOM, and the hook's arithmetic over them is what is asserted.
 *
 * The remaining gap — real reflow, real font swaps, real image loads — needs a browser-level test and is not
 * claimed here. "It looks fine" is how this ships broken, and so is "the unit test passes".
 */

interface SimulatedRects {
	readonly containerTop: number;
	readonly childTops: readonly number[];
	readonly childHeights: readonly number[];
}

function simulateLayout(container: HTMLElement, rects: SimulatedRects): void {
	vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
		top: rects.containerTop,
		bottom: rects.containerTop + 500,
		height: 500,
		left: 0,
		right: 0,
		width: 0,
		x: 0,
		y: rects.containerTop,
		toJSON: () => ({}),
	} as DOMRect);

	Array.from(container.children).forEach((child, index) => {
		const top = rects.childTops[index] ?? 0;
		const height = rects.childHeights[index] ?? 0;
		vi.spyOn(child as HTMLElement, "getBoundingClientRect").mockReturnValue({
			top,
			bottom: top + height,
			height,
			left: 0,
			right: 0,
			width: 0,
			x: 0,
			y: top,
			toJSON: () => ({}),
		} as DOMRect);
	});
}

let resizeCallbacks: ResizeObserverCallback[] = [];
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	// Capture the hook's ResizeObserver callback so a test can DRIVE it. jsdom never fires one, and a test that
	// asserted hand-computed arithmetic instead would be tautological — it would pass with the hook deleted.
	resizeCallbacks = [];
	globalThis.ResizeObserver = class {
		constructor(callback: ResizeObserverCallback) {
			resizeCallbacks.push(callback);
		}
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	vi.restoreAllMocks();
});

function mount(pinnedToBottom: boolean): HTMLElement {
	act(() => root.render(<Harness pinnedToBottom={pinnedToBottom} />));
	return host.querySelector("[data-testid=scroller]") as HTMLElement;
}

function Harness({ pinnedToBottom }: { pinnedToBottom: boolean }) {
	const ref = useRef<HTMLDivElement>(null);
	useScrollAnchor({ containerRef: ref, pinnedToBottom });
	return (
		<div ref={ref} data-testid="scroller">
			<div data-testid="a">a</div>
			<div data-testid="b">b</div>
			<div data-testid="c">c</div>
		</div>
	);
}

describe("useScrollAnchor", () => {
	it("is INERT when pinned to the bottom — growth there is expected and correct", () => {
		// Anchoring while pinned would fight the caller's scroll-to-bottom and produce a visible tug-of-war.
		const container = mount(true);
		const setter = vi.spyOn(container, "scrollTop", "set");
		container.dispatchEvent(new Event("scroll"));
		expect(setter).not.toHaveBeenCalled();
	});

	it("selects the first element INTERSECTING the viewport top, not the first fully visible one", () => {
		// A single tall message filling the screen would otherwise lose the anchor entirely — the case where
		// jumping is worst. Child "a" starts above the fold and still intersects: it must be chosen.
		const container = mount(false);
		simulateLayout(container, { containerTop: 100, childTops: [50, 400, 800], childHeights: [300, 380, 200] });
		container.dispatchEvent(new Event("scroll"));
		// "a" spans 50..350 against a container top of 100, so it intersects and is the anchor at offset -50.
		let scrollTop = 1000;
		Object.defineProperty(container, "scrollTop", {
			get: () => scrollTop,
			set: (value: number) => {
				scrollTop = value;
			},
			configurable: true,
		});
		// Content ABOVE the viewport grows by 40: every child shifts down by 40.
		simulateLayout(container, { containerTop: 100, childTops: [90, 440, 840], childHeights: [300, 380, 200] });
		// DRIVE the hook's own observer rather than asserting arithmetic computed here.
		for (const callback of resizeCallbacks) {
			callback([], {} as ResizeObserver);
		}
		// The visible text must not move, so the hook must add exactly the 40px it shifted.
		expect(scrollTop).toBe(1040);
	});

	it("does not RE-APPLY a correction when the observer fires again for the same shift", () => {
		// U1c found that the anchor is refreshed only by a `scroll` event, and that a programmatic `scrollTop`
		// write does not reliably dispatch one — leaving a stale offset that the next callback corrects against a
		// second time. Re-measuring after each correction is what makes a repeat callback a no-op; without it this
		// doubles to 1080 and, on a large collapse, drives the reader to the top of the chat.
		const container = mount(false);
		simulateLayout(container, { containerTop: 100, childTops: [50, 400, 800], childHeights: [300, 380, 200] });
		container.dispatchEvent(new Event("scroll"));
		let scrollTop = 1000;
		Object.defineProperty(container, "scrollTop", {
			get: () => scrollTop,
			set: (value: number) => {
				scrollTop = value;
			},
			configurable: true,
		});
		simulateLayout(container, { containerTop: 100, childTops: [90, 440, 840], childHeights: [300, 380, 200] });
		for (const callback of resizeCallbacks) {
			callback([], {} as ResizeObserver);
		}
		expect(scrollTop).toBe(1040);
		// Same layout, observer fires again — nothing further moved, so nothing further may be corrected.
		for (const callback of resizeCallbacks) {
			callback([], {} as ResizeObserver);
		}
		expect(scrollTop).toBe(1040);
	});

	it("mounts and unmounts without throwing when observers are unavailable", () => {
		// Older environments and SSR have no ResizeObserver; the hook must degrade rather than crash a panel.
		const original = globalThis.ResizeObserver;
		// @ts-expect-error deliberately removing the global to exercise the guard
		globalThis.ResizeObserver = undefined;
		expect(() => mount(false)).not.toThrow();
		globalThis.ResizeObserver = original;
	});

	it("does not correct sub-pixel drift", () => {
		// Correcting fractions of a pixel costs a reflow and buys nothing a reader can perceive.
		const container = mount(false);
		simulateLayout(container, { containerTop: 0, childTops: [0, 100, 200], childHeights: [100, 100, 100] });
		container.dispatchEvent(new Event("scroll"));
		const setter = vi.spyOn(container, "scrollTop", "set");
		simulateLayout(container, { containerTop: 0, childTops: [0.4, 100, 200], childHeights: [100, 100, 100] });
		container.dispatchEvent(new Event("scroll"));
		expect(setter).not.toHaveBeenCalled();
	});
});
