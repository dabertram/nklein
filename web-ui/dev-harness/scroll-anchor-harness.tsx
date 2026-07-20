/**
 * U1c — a REAL-BROWSER harness for `useScrollAnchor`. Dev-only; not part of any build.
 *
 * U1b's unit tests state their own limit outright: **jsdom performs no layout**, so they can prove the hook's
 * arithmetic and control flow but not that a chat stops jumping. This page closes exactly that gap and nothing
 * more — real reflow, a real ResizeObserver, real scroll positions.
 *
 * It imports the SHIPPING hook. A harness that reimplemented the logic would be the tautology U1b already
 * tripped over once: a test that passes with the hook deleted proves only that the test runs.
 *
 * ── THE CONTROL IS THE POINT ──
 * `?anchor=off` mounts the identical page with the hook disabled. Without it, "the text did not move" is
 * unfalsifiable — a harness that cannot make the bug appear cannot claim to have detected its absence. The
 * expected result is a visible jump with `off` and none with `on`, measured the same way.
 */

import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useScrollAnchor } from "../src/hooks/use-scroll-anchor";

const anchorEnabled = new URLSearchParams(window.location.search).get("anchor") !== "off";

/** A block whose height changes, standing in for a thinking block that collapses when it finishes. */
function CollapsibleBlock({ index, collapsed }: { index: number; collapsed: boolean }) {
	return (
		<div data-testid={`block-${index}`} style={{ border: "1px solid #ccc", margin: "8px 0", padding: 8 }}>
			<strong>Block {index}</strong>
			{!collapsed && (
				<div data-testid={`block-${index}-body`}>
					{Array.from({ length: 12 }, (_, line) => (
						<p key={line} style={{ margin: "4px 0" }}>
							Reasoning line {line} of block {index} — this is the content that disappears on collapse.
						</p>
					))}
				</div>
			)}
		</div>
	);
}

function Harness() {
	// Blocks 0–3 sit ABOVE the fold once scrolled; collapsing them is what shifts everything below.
	const [collapsed, setCollapsed] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	// `pinnedToBottom: false` — the reader has scrolled away, which is the only case U1 governs.
	// The control passes `true` instead: React forbids calling a hook conditionally, and `pinnedToBottom: true` is
	// the hook's own documented inert path, so it is the closest available stand-in for "not mounted".
	useScrollAnchor({ containerRef, pinnedToBottom: !anchorEnabled });

	return (
		<div style={{ fontFamily: "system-ui", padding: 16 }}>
			<h1 style={{ fontSize: 16 }}>U1c harness — anchoring {anchorEnabled ? "ON" : "OFF (control)"}</h1>
			<button type="button" data-testid="collapse" onClick={() => setCollapsed((value) => !value)}>
				Toggle collapse of blocks above
			</button>
			<div
				ref={containerRef}
				data-testid="scroller"
				style={{ height: 400, overflowY: "auto", border: "2px solid #333", marginTop: 12 }}
			>
				{Array.from({ length: 12 }, (_, index) => (
					<CollapsibleBlock key={index} index={index} collapsed={collapsed && index < 4} />
				))}
			</div>
		</div>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<Harness />
	</StrictMode>,
);
