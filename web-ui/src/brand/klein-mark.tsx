/**
 * §5.AX !Klein identity — the CONSTELLATION-K swarm mark (user pick 2026-07-02).
 *
 * Five nodes whose connecting edges trace a "K": a constellation that IS the letter, evoking the multi-model
 * swarm. Two-accent semantics baked in (user decision): CYAN = worker/tool nodes, VIOLET = the AI hub node
 * (reviewer/critic — the swarm's own intelligence). Pure presentational SVG; colors come from currentColor +
 * the two accent props so a caller can theme it (dark-first default, light variant, monochrome for favicons).
 *
 * `live` turns the hub node into a slow pulse — the mark doubles as a top-bar status glyph while the swarm works.
 */

import type { ReactElement } from "react";

export interface KleinMarkProps {
	size?: number;
	/** Worker/tool node + edge color. Defaults to the cyan token. */
	cyan?: string;
	/** AI hub node color. Defaults to the violet token. */
	violet?: string;
	/** Edge color (dim). Defaults to a low-chroma line. */
	edge?: string;
	/** Pulse the hub node (swarm-active status glyph). */
	live?: boolean;
	/** Monochrome mode (favicons / disabled state): every node uses `mono`, edges a dim of it. */
	mono?: string;
	title?: string;
	className?: string;
}

const CYAN = "#3fe0e0";
const VIOLET = "#9d7bff";
const EDGE = "#26333f";

/**
 * The five constellation nodes (viewBox 0 0 72 72). Edges trace a K: the left spine (top→mid→bottom) and the two
 * arms fanning from the mid hub to the top-right and bottom-right. The hub (index 2) is the AI node.
 */
const NODES = [
	{ x: 20, y: 14, r: 4.5, role: "worker" },
	{ x: 20, y: 58, r: 4.5, role: "worker" },
	{ x: 20, y: 36, r: 5.5, role: "hub" },
	{ x: 50, y: 14, r: 4.5, role: "worker" },
	{ x: 50, y: 58, r: 4.5, role: "worker" },
] as const;

const EDGES = [
	{ from: 0, to: 2, ai: false }, // top spine
	{ from: 2, to: 1, ai: false }, // bottom spine
	{ from: 2, to: 3, ai: true }, // upper arm (from the AI hub)
	{ from: 2, to: 4, ai: false }, // lower arm
] as const;

export function KleinMark({
	size = 28,
	cyan = CYAN,
	violet = VIOLET,
	edge = EDGE,
	live = false,
	mono,
	title = "!Klein",
	className,
}: KleinMarkProps): ReactElement {
	const workerColor = mono ?? cyan;
	const hubColor = mono ?? violet;
	const edgeColor = mono ? withAlpha(mono, 0.4) : edge;
	const aiEdgeColor = mono ? withAlpha(mono, 0.4) : withAlpha(violet, 0.45);
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 72 72"
			role="img"
			aria-label={title}
			className={className}
			fill="none"
		>
			<title>{title}</title>
			{EDGES.map((e, i) => {
				const a = NODES[e.from];
				const b = NODES[e.to];
				return (
					<line
						key={`e${i}`}
						x1={a.x}
						y1={a.y}
						x2={b.x}
						y2={b.y}
						stroke={e.ai ? aiEdgeColor : edgeColor}
						strokeWidth={2}
						strokeLinecap="round"
					/>
				);
			})}
			{NODES.map((n, i) => (
				<circle key={`n${i}`} cx={n.x} cy={n.y} r={n.r} fill={n.role === "hub" ? hubColor : workerColor}>
					{live && n.role === "hub" ? (
						<animate attributeName="opacity" values="1;0.45;1" dur="1.6s" repeatCount="indefinite" />
					) : null}
				</circle>
			))}
		</svg>
	);
}

/** The horizontal lockup: the mark + the "!Klein" wordmark (the "!" carries the cyan brand hook). */
export function KleinWordmark({
	size = 22,
	cyan = CYAN,
	violet = VIOLET,
	live = false,
	className,
}: Pick<KleinMarkProps, "cyan" | "violet" | "live" | "className"> & { size?: number }): ReactElement {
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
			<KleinMark size={size * 1.3} cyan={cyan} violet={violet} live={live} />
			<span>
				<span style={{ color: cyan }}>!</span>
				Klein
			</span>
		</span>
	);
}

function withAlpha(hex: string, alpha: number): string {
	const n = hex.replace("#", "");
	const r = Number.parseInt(n.slice(0, 2), 16);
	const g = Number.parseInt(n.slice(2, 4), 16);
	const b = Number.parseInt(n.slice(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
