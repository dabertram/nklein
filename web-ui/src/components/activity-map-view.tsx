// §5.BB Zoom 0 — the ACTIVITY MAP view (user-approved mockup: klein-zoom-levels-2026-07-03.html). Renders the
// composed map as SVG: cluster halos whose glow tracks activity, state-colored bubbles (pulsing while a model
// works, fading as completions age), and dependency connections (cross-cluster dashed violet). Interactions:
// click a bubble → open the card; click a cluster halo/label → zoom into that stream's lean board.

import { type ReactElement, useEffect, useRef, useState } from "react";

import type { ActivityBubbleState, ActivityMap } from "@/components/activity-map-model";

const STATE_STYLE: Record<ActivityBubbleState, { fill: string; stroke: string }> = {
	running: { fill: "color-mix(in srgb, var(--color-accent) 20%, transparent)", stroke: "var(--color-accent)" },
	review: { fill: "color-mix(in srgb, var(--color-accent-2) 20%, transparent)", stroke: "var(--color-accent-2)" },
	waiting: {
		fill: "color-mix(in srgb, var(--color-status-gold) 16%, transparent)",
		stroke: "var(--color-status-gold)",
	},
	blocked: { fill: "color-mix(in srgb, var(--color-status-red) 16%, transparent)", stroke: "var(--color-status-red)" },
	done: {
		fill: "color-mix(in srgb, var(--color-status-green) 14%, transparent)",
		stroke: "var(--color-status-green)",
	},
	idle: { fill: "var(--color-surface-3)", stroke: "var(--color-border-bright)" },
};

/** Deterministic cluster anchor points (fractions of the stage) for up to 6 clusters; wraps beyond that. */
const CLUSTER_ANCHORS: readonly { x: number; y: number }[] = [
	{ x: 0.3, y: 0.36 },
	{ x: 0.68, y: 0.3 },
	{ x: 0.5, y: 0.72 },
	{ x: 0.16, y: 0.72 },
	{ x: 0.84, y: 0.62 },
	{ x: 0.5, y: 0.14 },
];

interface BubblePosition {
	x: number;
	y: number;
	/** Label below (default) or above the bubble — staggered on dense rings to reduce collisions. */
	labelAbove: boolean;
}

/**
 * Distribute a cluster's bubbles over CONCENTRIC RINGS instead of one fixed circle — a 12-card cluster on a
 * single ring stacked every label on its neighbor (the "lazy sketch" impression, David 2026-07-09). Ring
 * capacities grow outward (6, 11, 16, …); rings are angle-staggered so bubbles don't align radially.
 */
function ringAssignments(count: number): { ring: number; indexInRing: number; ringSize: number; rings: number }[] {
	const capacities: number[] = [];
	let remaining = count;
	for (let ring = 0; remaining > 0; ring++) {
		const capacity = Math.min(remaining, 6 + ring * 5);
		capacities.push(capacity);
		remaining -= capacity;
	}
	const assignments: { ring: number; indexInRing: number; ringSize: number; rings: number }[] = [];
	capacities.forEach((ringSize, ring) => {
		for (let indexInRing = 0; indexInRing < ringSize; indexInRing++) {
			assignments.push({ ring, indexInRing, ringSize, rings: capacities.length });
		}
	});
	return assignments;
}

export function ActivityMapView({
	map,
	onSelectCard,
	onZoomToStream,
	highlightCardId = null,
}: {
	map: ActivityMap;
	onSelectCard: (cardId: string) => void;
	onZoomToStream: (clusterId: string) => void;
	/** §5.BB: the card to spotlight (hovering its chat mention) — a bright ring on its bubble. */
	highlightCardId?: string | null;
}): ReactElement {
	const containerRef = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ width: 860, height: 640 });

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}
		const observer = new ResizeObserver(() => {
			setSize({ width: container.clientWidth || 860, height: container.clientHeight || 640 });
		});
		observer.observe(container);
		return () => observer.disconnect();
	}, []);

	if (map.totalCards === 0) {
		return (
			<div
				className="flex flex-1 items-center justify-center text-sm text-text-tertiary"
				data-testid="activity-map-empty"
			>
				No cards yet — create a task or ask !Klein in the chat to plan one.
			</div>
		);
	}

	const { width, height } = size;
	const positions = new Map<string, BubblePosition>();
	const clusterGeometry = map.clusters.map((cluster, index) => {
		const anchor = CLUSTER_ANCHORS[index % CLUSTER_ANCHORS.length] ?? { x: 0.5, y: 0.5 };
		const cx = anchor.x * width;
		const cy = anchor.y * height;
		const assignments = ringAssignments(cluster.bubbles.length);
		const ringsTotal = assignments[0]?.rings ?? 1;
		const haloRadius = Math.min(230, 64 + ringsTotal * 52 + cluster.bubbles.length * 2);
		cluster.bubbles.forEach((bubble, bubbleIndex) => {
			const slot = assignments[bubbleIndex] ?? { ring: 0, indexInRing: 0, ringSize: 1, rings: 1 };
			// Radial fraction per ring: a lone ring sits mid-halo; multiple rings spread 0.30 → 0.72.
			const fraction = ringsTotal === 1 ? 0.45 : 0.3 + (slot.ring / Math.max(1, ringsTotal - 1)) * 0.42;
			// Stagger ring start angles so bubbles never align radially (label pile-up).
			const angle =
				(slot.indexInRing / Math.max(1, slot.ringSize)) * Math.PI * 2 - Math.PI / 3 + slot.ring * (Math.PI / 7);
			const distance = haloRadius * fraction;
			positions.set(bubble.id, {
				x: cx + Math.cos(angle) * distance,
				y: cy + Math.sin(angle) * distance,
				labelAbove: ringsTotal > 1 && slot.indexInRing % 2 === 1,
			});
		});
		return { cluster, cx, cy, haloRadius };
	});

	return (
		<div ref={containerRef} className="relative flex-1 min-h-0 overflow-hidden" data-testid="activity-map">
			<svg
				width="100%"
				height="100%"
				viewBox={`0 0 ${width} ${height}`}
				role="img"
				aria-label="Project activity map"
			>
				<title>Project activity map</title>
				<defs>
					{/* Dependency direction matters — a blocked-by relation without an arrowhead is just a smudge. */}
					<marker
						id="activity-edge-arrow"
						viewBox="0 0 8 8"
						refX="7"
						refY="4"
						markerWidth="6"
						markerHeight="6"
						orient="auto-start-reverse"
					>
						<path d="M 0 0 L 8 4 L 0 8 z" fill="var(--color-accent)" fillOpacity="0.55" />
					</marker>
					<marker
						id="activity-edge-arrow-cross"
						viewBox="0 0 8 8"
						refX="7"
						refY="4"
						markerWidth="6"
						markerHeight="6"
						orient="auto-start-reverse"
					>
						<path d="M 0 0 L 8 4 L 0 8 z" fill="var(--color-accent-2)" fillOpacity="0.5" />
					</marker>
				</defs>
				{clusterGeometry.map(({ cluster, cx, cy, haloRadius }) => {
					// Anchor the caption to the halo's top-left, but CLAMP it into the canvas: a big halo (up to 230px
					// radius) reaches above y=0, and an un-clamped caption rendered off-screen — the whole cluster went
					// nameless (live-found 2026-07-10, the 18-card stream's title sat at y≈-8). Keep both lines together.
					const labelX = Math.max(8, cx - haloRadius * 0.7);
					const labelY = Math.max(14, cy - haloRadius - 8);
					return (
						<g key={cluster.id} onClick={() => onZoomToStream(cluster.id)} className="cursor-pointer">
							<circle
								cx={cx}
								cy={cy}
								r={haloRadius}
								fill="var(--color-accent)"
								opacity={0.03 + cluster.activity * 0.09}
							/>
							<text
								x={labelX}
								y={labelY}
								className="fill-text-tertiary text-[11px] font-semibold uppercase tracking-wider"
							>
								{cluster.label}
							</text>
							<text x={labelX} y={labelY + 15} className="fill-text-tertiary text-[10px]">
								{cluster.runningCount > 0 ? `${cluster.runningCount} running · ` : ""}
								{cluster.bubbles.length} card{cluster.bubbles.length === 1 ? "" : "s"}
							</text>
						</g>
					);
				})}
				{map.edges.map((edge) => {
					// EXECUTION-ORDER flow (David 2026-07-10): `fromCardId` DEPENDS ON `toCardId`, so the arrow runs
					// blocker → dependent — it points at what runs next (time flow), not at the dependency target.
					const from = positions.get(edge.toCardId);
					const to = positions.get(edge.fromCardId);
					if (!from || !to) {
						return null;
					}
					// Gentle curve (perpendicular bow) so parallel dependencies don't fuse into one line.
					const midX = (from.x + to.x) / 2;
					const midY = (from.y + to.y) / 2;
					const dx = to.x - from.x;
					const dy = to.y - from.y;
					const norm = Math.hypot(dx, dy) || 1;
					const bow = Math.min(22, norm * 0.14);
					const controlX = midX - (dy / norm) * bow;
					const controlY = midY + (dx / norm) * bow;
					return (
						<path
							key={`${edge.fromCardId}->${edge.toCardId}`}
							d={`M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}`}
							fill="none"
							stroke={edge.crossCluster ? "var(--color-accent-2)" : "var(--color-accent)"}
							strokeOpacity={edge.crossCluster ? 0.4 : 0.45}
							strokeWidth={1.5}
							strokeDasharray={edge.crossCluster ? "5 5" : undefined}
							markerEnd={edge.crossCluster ? "url(#activity-edge-arrow-cross)" : "url(#activity-edge-arrow)"}
						/>
					);
				})}
				{clusterGeometry.flatMap(({ cluster }) =>
					cluster.bubbles.map((bubble) => {
						const position = positions.get(bubble.id);
						if (!position) {
							return null;
						}
						const style = STATE_STYLE[bubble.state];
						const highlighted = highlightCardId === bubble.id;
						return (
							<g
								key={bubble.id}
								data-testid={`bubble-${bubble.id}`}
								data-state={bubble.state}
								data-highlighted={highlighted || undefined}
								className="cursor-pointer"
								opacity={1 - bubble.fade * 0.8}
								onClick={(event) => {
									event.stopPropagation();
									onSelectCard(bubble.id);
								}}
							>
								{highlighted ? (
									// §5.BB hover-spotlight: a bright cyan ring while the chat mention is hovered.
									<circle
										cx={position.x}
										cy={position.y}
										r={bubble.radius + 6}
										fill="none"
										stroke="var(--color-accent)"
										strokeWidth={2}
										strokeOpacity={0.9}
									/>
								) : null}
								<circle
									cx={position.x}
									cy={position.y}
									r={bubble.radius}
									fill={style.fill}
									stroke={style.stroke}
									strokeWidth={1.75}
								>
									{bubble.pulsing ? (
										<animate
											attributeName="stroke-opacity"
											values="0.9;0.25;0.9"
											dur="2s"
											repeatCount="indefinite"
										/>
									) : null}
								</circle>
								{bubble.pulsing ? (
									<circle
										cx={position.x}
										cy={position.y}
										r={bubble.radius * 0.35}
										fill={style.stroke}
										opacity={0.85}
									/>
								) : null}
								{bubble.showLabel ? (
									<text
										x={position.x}
										y={position.labelAbove ? position.y - bubble.radius - 6 : position.y + bubble.radius + 13}
										textAnchor="middle"
										className="fill-text-secondary text-[10px]"
									>
										{bubble.title.length > 26 ? `${bubble.title.slice(0, 24)}…` : bubble.title}
									</text>
								) : (
									<title>{bubble.title}</title>
								)}
							</g>
						);
					}),
				)}
			</svg>
			<div className="absolute bottom-3 left-3 rounded-md border border-border bg-surface-1/85 px-2.5 py-1.5 text-[11px] text-text-tertiary">
				{map.runningCount} running · {map.totalCards} cards — click a cluster to zoom in, a bubble to open the card
			</div>
			<div className="absolute right-3 top-3 flex flex-col gap-1 rounded-md border border-border bg-surface-1/90 px-2.5 py-2 text-[10.5px] text-text-tertiary">
				<span className="flex items-center gap-1.5">
					<i className="h-2 w-2 rounded-full bg-accent" /> running
				</span>
				<span className="flex items-center gap-1.5">
					<i className="h-2 w-2 rounded-full bg-accent-2" /> in review
				</span>
				<span className="flex items-center gap-1.5">
					<i className="h-2 w-2 rounded-full bg-status-gold" /> waiting / held
				</span>
				<span className="flex items-center gap-1.5">
					<i className="h-2 w-2 rounded-full bg-status-green" /> done
				</span>
			</div>
		</div>
	);
}
