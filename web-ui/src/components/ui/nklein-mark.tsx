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
	// Branded mode tints the constellation edges from the ACCENT (like the approved §5.AX mockups) — text-
	// tinted edges read as a different, disconnected element on colored themes.
	const edge = accent ? `color-mix(in srgb, ${accent} 42%, transparent)` : "currentColor";
	const opacityEdge = accent ? undefined : 0.4;
	return (
		<svg width={size} height={size} viewBox="0 0 72 72" fill="none" className={className} aria-hidden>
			{/* K spine (top→hub→bottom) + two arms fanning from the hub. Stroke 4 in the 72-box ≈ 1px at the
			    sidebar's 18px render — any thinner and the K dissolves into unconnected dots at small sizes. */}
			<g stroke={edge} strokeWidth={4} strokeLinecap="round" opacity={opacityEdge}>
				<line x1="20" y1="14" x2="20" y2="36" />
				<line x1="20" y1="36" x2="20" y2="58" />
				<line x1="20" y1="36" x2="50" y2="14" />
				<line x1="20" y1="36" x2="50" y2="58" />
			</g>
			<circle cx="20" cy="14" r="5.5" fill={worker} />
			<circle cx="20" cy="58" r="5.5" fill={worker} />
			<circle cx="50" cy="14" r="5.5" fill={worker} />
			<circle cx="50" cy="58" r="5.5" fill={worker} />
			<circle cx="20" cy="36" r="7" fill={hub}>
				{live ? <animate attributeName="opacity" values="1;0.45;1" dur="1.6s" repeatCount="indefinite" /> : null}
			</circle>
		</svg>
	);
}

/**
 * The horizontal lockup: the constellation-K mark + the "!Klein" wordmark (the "!" carries the accent hook).
 * For brand surfaces (about, wizards, empty states) — the compact sidebar header composes its own layout.
 */
export function NKleinWordmark({
	size = 22,
	accent = "var(--color-accent)",
	accent2 = "var(--color-accent-2)",
	live = false,
	className,
}: {
	size?: number;
	accent?: string;
	accent2?: string;
	live?: boolean;
	className?: string;
}): ReactElement {
	return (
		<span
			className={className}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 10,
				fontWeight: 700,
				fontSize: size,
				letterSpacing: "-0.01em",
			}}
		>
			<NKleinMark size={size * 1.3} accent={accent} accent2={accent2} live={live} />
			<span>
				<span style={{ color: accent }}>!</span>
				Klein
			</span>
		</span>
	);
}
