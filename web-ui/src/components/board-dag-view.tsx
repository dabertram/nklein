import type { RuntimeTaskSessionSummary } from "@runtime-contract";
import { X } from "lucide-react";
import type React from "react";
import { useMemo, useRef, useState } from "react";

import { buildDagGraph, DAG_LAYOUT, type DagNode } from "@/components/board-dag-model";
import { cn } from "@/components/ui/cn";
import type { BoardColumn as BoardColumnModel, BoardDependency } from "@/types";

/**
 * W3.4 — the dedicated, comprehensive DAG view over the WHOLE board: status-colored nodes (column × live session),
 * dependency edges in build order (from → to), pan (drag) + zoom (wheel), and CYCLE edges marked loud (red, dashed) —
 * a cycle is a planning bug the operator should see, not a line to hide. The kanban board keeps the LEAN treatment
 * (§5.BC overlay toggle); this is the complete picture, opened from the zoom bar at any zoom level. The pure layout +
 * cycle-detection model lives in `board-dag-model.ts` (unit-tested); this file is the SVG view + pan/zoom over it.
 */

const { nodeW: NODE_W, nodeH: NODE_H } = DAG_LAYOUT;

function nodeStyle(node: DagNode): { fill: string; stroke: string } {
	if (node.failed) {
		return { fill: "var(--color-status-red)", stroke: "var(--color-status-red)" };
	}
	if (node.running) {
		return { fill: "var(--color-accent)", stroke: "var(--color-accent)" };
	}
	switch (node.columnId) {
		case "completed":
			return { fill: "var(--color-status-green)", stroke: "var(--color-status-green)" };
		case "review":
			return { fill: "var(--color-status-gold)", stroke: "var(--color-status-gold)" };
		case "in_progress":
			return { fill: "var(--color-accent)", stroke: "var(--color-accent)" };
		default:
			return { fill: "var(--color-text-tertiary)", stroke: "var(--color-border-bright)" };
	}
}

export function BoardDagView({
	open,
	columns,
	dependencies,
	sessions,
	onClose,
	onSelectCard,
}: {
	open: boolean;
	columns: readonly BoardColumnModel[];
	dependencies: readonly BoardDependency[];
	sessions: Record<string, RuntimeTaskSessionSummary>;
	onClose: () => void;
	onSelectCard: (cardId: string) => void;
}): React.ReactElement | null {
	// Pan/zoom: a viewBox transform driven by pointer drag + wheel.
	const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
	const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

	const graph = useMemo(() => buildDagGraph(columns, dependencies, sessions), [columns, dependencies, sessions]);

	if (!open) {
		return null;
	}

	const viewW = graph.width / view.scale;
	const viewH = graph.height / view.scale;

	return (
		<div className="fixed inset-0 z-50 flex flex-col bg-surface-0/95 backdrop-blur-sm" data-testid="board-dag-view">
			<div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-1 px-4 py-2">
				<span className="text-sm font-semibold text-text-primary">Dependency graph</span>
				<span className="text-[11.5px] text-text-tertiary">
					{graph.nodes.length} cards · {graph.edges.length} edges
					{graph.cycleEdgeIds.size > 0 ? (
						<span className="ml-1 text-status-red">· {graph.cycleEdgeIds.size} cycle edge(s)!</span>
					) : null}
					{" — drag to pan, scroll to zoom, click a card to open it"}
				</span>
				<button
					type="button"
					aria-label="Close dependency graph"
					data-testid="board-dag-close"
					onClick={onClose}
					className="ml-auto rounded-md p-1.5 text-text-tertiary hover:bg-surface-3 hover:text-text-primary"
				>
					<X size={16} />
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-hidden">
				{graph.nodes.length === 0 ? (
					<div className="flex h-full items-center justify-center text-sm text-text-tertiary">
						No cards on the board yet.
					</div>
				) : (
					<svg
						width="100%"
						height="100%"
						viewBox={`${view.x} ${view.y} ${viewW} ${viewH}`}
						role="img"
						aria-label="Board dependency graph"
						className="cursor-grab active:cursor-grabbing"
						onPointerDown={(event) => {
							dragRef.current = {
								startX: event.clientX,
								startY: event.clientY,
								originX: view.x,
								originY: view.y,
							};
							event.currentTarget.setPointerCapture(event.pointerId);
						}}
						onPointerMove={(event) => {
							const drag = dragRef.current;
							if (!drag) {
								return;
							}
							const bounds = event.currentTarget.getBoundingClientRect();
							const unitsPerPixel = viewW / bounds.width;
							setView((current) => ({
								...current,
								x: drag.originX - (event.clientX - drag.startX) * unitsPerPixel,
								y: drag.originY - (event.clientY - drag.startY) * unitsPerPixel,
							}));
						}}
						onPointerUp={() => {
							dragRef.current = null;
						}}
						onWheel={(event) => {
							const factor = event.deltaY > 0 ? 0.9 : 1.1;
							setView((current) => ({
								...current,
								scale: Math.min(4, Math.max(0.25, current.scale * factor)),
							}));
						}}
					>
						<title>Board dependency graph</title>
						{graph.edges.map((edge) => {
							// EXECUTION-ORDER flow (David 2026-07-10): `from` depends on `to`, so the line runs
							// blocker (to, left layer) → dependent (from, right layer) — with the arrow-dot at the
							// dependent end ("what runs next"), matching the board's left→right time flow.
							const blocker = graph.positions.get(edge.toTaskId);
							const dependent = graph.positions.get(edge.fromTaskId);
							if (!blocker || !dependent) {
								return null;
							}
							const isCycle = graph.cycleEdgeIds.has(edge.id);
							const x1 = blocker.x + NODE_W;
							const y1 = blocker.y + NODE_H / 2;
							const x2 = dependent.x;
							const y2 = dependent.y + NODE_H / 2;
							const midX = (x1 + x2) / 2;
							return (
								<g key={edge.id} data-testid={isCycle ? "dag-cycle-edge" : "dag-edge"}>
									<path
										d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
										fill="none"
										stroke={isCycle ? "var(--color-status-red)" : "var(--color-accent)"}
										strokeOpacity={isCycle ? 0.9 : 0.35}
										strokeWidth={isCycle ? 2 : 1.5}
										strokeDasharray={isCycle ? "6 4" : undefined}
									/>
									<circle
										cx={x2}
										cy={y2}
										r={2.5}
										fill={isCycle ? "var(--color-status-red)" : "var(--color-accent)"}
									/>
								</g>
							);
						})}
						{graph.nodes.map((node) => {
							const position = graph.positions.get(node.id);
							if (!position) {
								return null;
							}
							const style = nodeStyle(node);
							return (
								<g
									key={node.id}
									data-testid={`dag-node-${node.id}`}
									role="button"
									tabIndex={0}
									className="cursor-pointer"
									onClick={() => onSelectCard(node.id)}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											onSelectCard(node.id);
										}
									}}
								>
									<rect
										x={position.x}
										y={position.y}
										width={NODE_W}
										height={NODE_H}
										rx={8}
										fill="var(--color-surface-2)"
										stroke={style.stroke}
										strokeWidth={1.5}
									/>
									<rect x={position.x} y={position.y} width={4} height={NODE_H} rx={2} fill={style.fill} />
									<text
										x={position.x + 12}
										y={position.y + NODE_H / 2 + 4}
										className={cn("text-[11.5px]", node.running && "font-semibold")}
										fill="var(--color-text-primary)"
									>
										{node.title.length > 24 ? `${node.title.slice(0, 23)}…` : node.title}
									</text>
									{node.running ? (
										<circle
											cx={position.x + NODE_W - 10}
											cy={position.y + 10}
											r={3.5}
											fill="var(--color-accent)"
										>
											<animate
												attributeName="opacity"
												values="1;0.3;1"
												dur="1.6s"
												repeatCount="indefinite"
											/>
										</circle>
									) : null}
								</g>
							);
						})}
					</svg>
				)}
			</div>
		</div>
	);
}
