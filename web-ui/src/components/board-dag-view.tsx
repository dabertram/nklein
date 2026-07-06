import type { RuntimeTaskSessionSummary } from "@runtime-contract";
import { X } from "lucide-react";
import type React from "react";
import { useMemo, useRef, useState } from "react";

import { cn } from "@/components/ui/cn";
import type { BoardColumnId, BoardColumn as BoardColumnModel, BoardDependency } from "@/types";

/**
 * W3.4 — the dedicated, comprehensive DAG view over the WHOLE board: status-colored nodes (column × live session),
 * dependency edges in build order (from → to), pan (drag) + zoom (wheel), and CYCLE edges marked loud (red, dashed) —
 * a cycle is a planning bug the operator should see, not a line to hide. The kanban board keeps the LEAN treatment
 * (§5.BC overlay toggle); this is the complete picture, opened from the zoom bar at any zoom level.
 *
 * Layout mirrors the decomposition preview (longest-path layers, no library): roots left, flowing right — build
 * order reads left→right like a pipeline.
 */

interface DagNode {
	id: string;
	title: string;
	columnId: BoardColumnId;
	running: boolean;
	failed: boolean;
}

const NODE_W = 168;
const NODE_H = 44;
const GAP_X = 64;
const GAP_Y = 18;
const PAD = 28;

/** Longest-path depth per node over the dependency edges (cycle-guarded — cycles get depth 0 at the re-entry). */
function computeDepths(ids: readonly string[], dependsOn: Map<string, string[]>): Map<string, number> {
	const depthById = new Map<string, number>();
	const inProgress = new Set<string>();
	const known = new Set(ids);
	const depthOf = (id: string): number => {
		const cached = depthById.get(id);
		if (cached !== undefined) {
			return cached;
		}
		if (inProgress.has(id)) {
			return 0; // cycle guard
		}
		inProgress.add(id);
		const deps = (dependsOn.get(id) ?? []).filter((dep) => dep !== id && known.has(dep));
		const depth = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(depthOf));
		inProgress.delete(id);
		depthById.set(id, depth);
		return depth;
	};
	for (const id of ids) {
		depthOf(id);
	}
	return depthById;
}

/** Edges participating in a dependency cycle (DFS back-edge detection) — drawn loud. */
function findCycleEdgeIds(ids: readonly string[], edges: readonly BoardDependency[]): Set<string> {
	const out = new Map<string, BoardDependency[]>();
	for (const edge of edges) {
		out.set(edge.fromTaskId, [...(out.get(edge.fromTaskId) ?? []), edge]);
	}
	const cycleEdges = new Set<string>();
	const visiting = new Set<string>();
	const done = new Set<string>();
	const visit = (id: string): void => {
		if (done.has(id) || visiting.has(id)) {
			return;
		}
		visiting.add(id);
		for (const edge of out.get(id) ?? []) {
			if (visiting.has(edge.toTaskId)) {
				cycleEdges.add(edge.id); // back edge = part of a cycle
			} else {
				visit(edge.toTaskId);
			}
		}
		visiting.delete(id);
		done.add(id);
	};
	for (const id of ids) {
		visit(id);
	}
	return cycleEdges;
}

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

	const graph = useMemo(() => {
		const nodes: DagNode[] = columns.flatMap((column) =>
			column.id === "trash"
				? []
				: column.cards.map((card) => ({
						id: card.id,
						title: card.title,
						columnId: column.id,
						running: sessions[card.id]?.state === "running",
						failed: sessions[card.id]?.state === "failed" || card.blockedKind != null,
					})),
		);
		const ids = nodes.map((node) => node.id);
		const idSet = new Set(ids);
		const edges = dependencies.filter((edge) => idSet.has(edge.fromTaskId) && idSet.has(edge.toTaskId));
		const dependsOn = new Map<string, string[]>();
		for (const edge of edges) {
			// `to` depends on `from` (from must land first) — depth flows along build order.
			dependsOn.set(edge.toTaskId, [...(dependsOn.get(edge.toTaskId) ?? []), edge.fromTaskId]);
		}
		const depths = computeDepths(ids, dependsOn);
		const cycleEdgeIds = findCycleEdgeIds(ids, edges);
		// Column-per-depth layout: x = depth, y = index within the depth.
		const byDepth = new Map<number, DagNode[]>();
		for (const node of nodes) {
			const depth = depths.get(node.id) ?? 0;
			byDepth.set(depth, [...(byDepth.get(depth) ?? []), node]);
		}
		const positions = new Map<string, { x: number; y: number }>();
		for (const [depth, layer] of byDepth) {
			layer.forEach((node, index) => {
				positions.set(node.id, {
					x: PAD + depth * (NODE_W + GAP_X),
					y: PAD + index * (NODE_H + GAP_Y),
				});
			});
		}
		const width = PAD * 2 + (Math.max(0, ...byDepth.keys()) + 1) * (NODE_W + GAP_X) - GAP_X;
		const height =
			PAD * 2 + Math.max(0, ...[...byDepth.values()].map((layer) => layer.length)) * (NODE_H + GAP_Y) - GAP_Y;
		return { nodes, edges, positions, cycleEdgeIds, width: Math.max(width, 320), height: Math.max(height, 200) };
	}, [columns, dependencies, sessions]);

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
							const from = graph.positions.get(edge.fromTaskId);
							const to = graph.positions.get(edge.toTaskId);
							if (!from || !to) {
								return null;
							}
							const isCycle = graph.cycleEdgeIds.has(edge.id);
							const x1 = from.x + NODE_W;
							const y1 = from.y + NODE_H / 2;
							const x2 = to.x;
							const y2 = to.y + NODE_H / 2;
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
