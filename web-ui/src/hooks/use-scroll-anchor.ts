import { type RefObject, useEffect } from "react";

/**
 * U1 — keep the text under the reader's eyes STATIONARY while content above it changes height.
 *
 * David, 2026-07-20: *"while reading the chat log it happens regularly that the text 'jumps' when thinking
 * blocks collapse after they finish … the user must never get distracted by 'lines moving' while user is
 * reading."*
 *
 * ── THE SCOPE IS THE PRECISE PART ──
 * Pinned to the bottom, the user is WATCHING the latest output: growth is expected and moving is correct, so
 * this hook does nothing. Detached from the bottom, the user is READING, and **nothing above the viewport may
 * shift the visible text by a single pixel.** Content may still arrive and blocks may still collapse — the
 * reader simply must not be able to tell.
 *
 * ── WHY AN EXPLICIT ANCHOR RATHER THAN CSS `overflow-anchor` ──
 * `overflow-anchor: auto` is the browser's native version of this and is tried first (see the stylesheet). It is
 * unreliable across children whose height changes for reasons the browser did not initiate — collapsing a
 * `<details>`, a late-loading image claiming height, a streamed block reflowing — and it silently does nothing
 * when it cannot pick an anchor. **Silently doing nothing is indistinguishable from working**, which is why this
 * hook does not rely on it.
 *
 * ── WHY IT ANCHORS TO AN ELEMENT, NOT TO A DISTANCE ──
 * The obvious implementation preserves `scrollHeight − scrollTop` (distance from the bottom). That anchors the
 * reader to the BOTTOM, so any content appended below yanks the view — the exact bug, moved. Anchoring to a real
 * element's position in the viewport is the only formulation where "content arrived somewhere else" is a no-op.
 */

export interface ScrollAnchorOptions {
	/** The scrolling container. */
	readonly containerRef: RefObject<HTMLElement | null>;
	/**
	 * True when the view is pinned to the bottom. Anchoring is DISABLED then — the caller's own
	 * scroll-to-bottom must win, and fighting it would produce a visible tug-of-war.
	 */
	readonly pinnedToBottom: boolean;
	/** CSS selector for anchorable children. Defaults to direct children. */
	readonly itemSelector?: string;
}

/** Ignore sub-pixel drift: correcting it costs a reflow and buys nothing a reader can perceive. */
const MIN_CORRECTION_PX = 1;

export function useScrollAnchor({ containerRef, pinnedToBottom, itemSelector }: ScrollAnchorOptions): void {
	useEffect(() => {
		const container = containerRef.current;
		if (!container || pinnedToBottom || typeof ResizeObserver === "undefined") {
			return;
		}

		/** The element currently at the top of the viewport, and where in the viewport it sits. */
		let anchorElement: HTMLElement | null = null;
		let anchorViewportOffset = 0;

		const selectAnchor = (): void => {
			const children = itemSelector
				? Array.from(container.querySelectorAll<HTMLElement>(itemSelector))
				: (Array.from(container.children) as HTMLElement[]);
			const containerTop = container.getBoundingClientRect().top;
			// The FIRST element intersecting the viewport top. Choosing the first *fully* visible one instead would
			// lose the anchor whenever a single tall message fills the screen — the case where jumping is worst.
			anchorElement =
				children.find((child) => {
					const rect = child.getBoundingClientRect();
					return rect.bottom > containerTop;
				}) ?? null;
			anchorViewportOffset = anchorElement ? anchorElement.getBoundingClientRect().top - containerTop : 0;
		};

		const restoreAnchor = (): void => {
			if (!anchorElement || !container.contains(anchorElement)) {
				// The anchor was removed (a message replaced, a collapse re-rendering its subtree). Re-select rather
				// than correcting against a stale element — a correction computed from a detached node would move the
				// view to an arbitrary place, which is worse than the jump it was preventing.
				selectAnchor();
				return;
			}
			const containerTop = container.getBoundingClientRect().top;
			const currentOffset = anchorElement.getBoundingClientRect().top - containerTop;
			const drift = currentOffset - anchorViewportOffset;
			if (Math.abs(drift) >= MIN_CORRECTION_PX) {
				container.scrollTop += drift;
			}
		};

		selectAnchor();

		// ResizeObserver catches height changes the browser makes without a scroll event: a collapsing block, an
		// image claiming height, a font swap re-measuring every line. A scroll listener alone would miss all three,
		// which is precisely the set of cases David named.
		const resizeObserver = new ResizeObserver(() => {
			restoreAnchor();
		});
		resizeObserver.observe(container);
		for (const child of Array.from(container.children)) {
			resizeObserver.observe(child);
		}

		// Children arriving or leaving must be observed too, or a newly-collapsed block added after mount is unwatched.
		const mutationObserver = new MutationObserver((records) => {
			for (const record of records) {
				for (const added of Array.from(record.addedNodes)) {
					if (added instanceof HTMLElement) {
						resizeObserver.observe(added);
					}
				}
			}
			restoreAnchor();
		});
		mutationObserver.observe(container, { childList: true, subtree: true });

		// A real user scroll re-selects the anchor: after they move, the element under their eyes is a different one.
		const handleScroll = (): void => {
			selectAnchor();
		};
		container.addEventListener("scroll", handleScroll, { passive: true });

		return () => {
			resizeObserver.disconnect();
			mutationObserver.disconnect();
			container.removeEventListener("scroll", handleScroll);
		};
	}, [containerRef, pinnedToBottom, itemSelector]);
}
