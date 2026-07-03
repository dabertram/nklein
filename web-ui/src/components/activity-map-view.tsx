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
}

export function ActivityMapView({
	map,
	onSelectCard,
	onZoomToStream,
}: {
	map: ActivityMap;
	onSelectCard: (cardId: string) => void;
	onZoomToStream: (clusterId: string) => void;
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
		const haloRadius = Math.min(170, 84 + cluster.bubbles.length * 12);
		cluster.bubbles.forEach((bubble, bubbleIndex) => {
			const angle = (bubbleIndex / Math.max(1, cluster.bubbles.length)) * Math.PI * 2 - Math.PI / 3;
			const distance = haloRadius * 0.48;
			positions.set(bubble.id, { x: cx + Math.cos(angle) * distance, y: cy + Math.sin(angle) * distance });
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
				{clusterGeometry.map(({ cluster, cx, cy, haloRadius }) => (
					<g key={cluster.id} onClick={() => onZoomToStream(cluster.id)} className="cursor-pointer">
						<circle
							cx={cx}
							cy={cy}
							r={haloRadius}
							fill="var(--color-accent)"
							opacity={0.03 + cluster.activity * 0.09}
						/>
						<text
							x={cx - haloRadius * 0.7}
							y={cy - haloRadius - 8}
							className="fill-text-tertiary text-[11px] font-semibold uppercase tracking-wider"
						>
							{cluster.label}
						</text>
						<text x={cx - haloRadius * 0.7} y={cy - haloRadius + 7} className="fill-text-tertiary text-[10px]">
							{cluster.runningCount > 0 ? `${cluster.runningCount} running · ` : ""}
							{cluster.bubbles.length} card{cluster.bubbles.length === 1 ? "" : "s"}
						</text>
					</g>
				))}
				{map.edges.map((edge) => {
					const from = positions.get(edge.fromCardId);
					const to = positions.get(edge.toCardId);
					if (!from || !to) {
						return null;
					}
					return (
						<line
							key={`${edge.fromCardId}->${edge.toCardId}`}
							x1={from.x}
							y1={from.y}
							x2={to.x}
							y2={to.y}
							stroke={edge.crossCluster ? "var(--color-accent-2)" : "var(--color-accent)"}
							strokeOpacity={edge.crossCluster ? 0.16 : 0.18}
							strokeWidth={1.25}
							strokeDasharray={edge.crossCluster ? "5 5" : undefined}
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
						return (
							<g
								key={bubble.id}
								data-testid={`bubble-${bubble.id}`}
								data-state={bubble.state}
								className="cursor-pointer"
								opacity={1 - bubble.fade * 0.8}
								onClick={(event) => {
									event.stopPropagation();
									onSelectCard(bubble.id);
								}}
							>
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
								<text
									x={position.x}
									y={position.y + bubble.radius + 13}
									textAnchor="middle"
									className="fill-text-secondary text-[10px]"
								>
									{bubble.title.length > 26 ? `${bubble.title.slice(0, 24)}…` : bubble.title}
								</text>
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
