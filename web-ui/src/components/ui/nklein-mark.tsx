import type { ReactElement } from "react";

/**
 * §5.AX !Klein identity — the CONSTELLATION-K swarm mark (user pick 2026-07-02).
 *
 * Five nodes whose connecting edges trace a "K": a constellation that IS the letter, evoking the multi-model
 * swarm. Two-accent semantics (user decision): CYAN = worker/tool nodes, VIOLET = the AI hub node
 * (reviewer/critic — the swarm's own intelligence).
 *
 * Default (no accent props) renders monochrome in `currentColor` so existing call sites (e.g. the sidebar header,
 * which sets `text-text-primary`) are unchanged. Pass `accent`/`accent2` for the branded two-accent rendering, or
 * `live` to pulse the AI hub node — turning the mark into a swarm-active status glyph.
 */
export function NKleinMark({
	size = 20,
	className,
	accent,
	accent2,
	live = false,
}: {
	size?: number;
	className?: string;
	/** Worker-node + edge color. Omit for monochrome `currentColor`. */
	accent?: string;
	/** AI hub-node color. Defaults to `accent` when omitted. */
	accent2?: string;
	/** Pulse the AI hub node (swarm-active). */
	live?: boolean;
}): ReactElement {
	const worker = accent ?? "currentColor";
	const hub = accent2 ?? accent ?? "currentColor";
	const edge = accent ? "color-mix(in srgb, currentColor 34%, transparent)" : "currentColor";
	const opacityEdge = accent ? undefined : 0.4;
	return (
		<svg width={size} height={size} viewBox="0 0 72 72" fill="none" className={className} aria-hidden>
			{/* K spine (top→hub→bottom) + two arms fanning from the hub */}
			<g stroke={edge} strokeWidth={2} strokeLinecap="round" opacity={opacityEdge}>
				<line x1="20" y1="14" x2="20" y2="36" />
				<line x1="20" y1="36" x2="20" y2="58" />
				<line x1="20" y1="36" x2="50" y2="14" />
				<line x1="20" y1="36" x2="50" y2="58" />
			</g>
			<circle cx="20" cy="14" r="4.5" fill={worker} />
			<circle cx="20" cy="58" r="4.5" fill={worker} />
			<circle cx="50" cy="14" r="4.5" fill={worker} />
			<circle cx="50" cy="58" r="4.5" fill={worker} />
			<circle cx="20" cy="36" r="5.5" fill={hub}>
				{live ? <animate attributeName="opacity" values="1;0.45;1" dur="1.6s" repeatCount="indefinite" /> : null}
			</circle>
		</svg>
	);
}
