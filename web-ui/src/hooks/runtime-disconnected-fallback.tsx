import type { ReactElement } from "react";
import { NKleinMark } from "@/components/ui/nklein-mark";

/**
 * §5.AX: the disconnected screen is a designed brand surface, not a default error state — the dimmed
 * constellation-K (no live pulse: the swarm is down) replaces the generic alert glyph, and a reload
 * button saves the user hunting for the browser refresh after restarting the server.
 */
export function RuntimeDisconnectedFallback(): ReactElement {
	return (
		<div
			style={{
				display: "flex",
				height: "100svh",
				alignItems: "center",
				justifyContent: "center",
				background: "var(--color-surface-0)",
				padding: "24px",
			}}
		>
			<div className="flex flex-col items-center justify-center gap-3 py-12 text-text-tertiary">
				<NKleinMark size={56} className="opacity-60" />
				<h3 className="font-semibold text-text-primary">
					Disconnected from <span style={{ color: "var(--color-accent)" }}>!</span>Klein
				</h3>
				<p className="text-text-secondary">Run nklein again in your terminal, then reload this tab.</p>
				<button
					type="button"
					onClick={() => window.location.reload()}
					className="mt-2 rounded-md border border-border-bright px-4 py-1.5 text-sm text-text-secondary transition-colors hover:border-border-focus hover:text-text-primary"
				>
					Reload
				</button>
			</div>
		</div>
	);
}
