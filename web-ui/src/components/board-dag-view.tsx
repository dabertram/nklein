import type { RuntimeTaskSessionSummary } from "@runtime-contract";
import type React from "react";
import { useMemo, useRef, useState } from "react";

import { buildDagGraph, DAG_LAYOUT, type DagFlowDirection, type DagNode } from "@/components/board-dag-model";
import { cn } from "@/components/ui/cn";
import type { BoardColumn as BoardColumnModel, BoardDependency } from "@/types";

/**
 * W3.4 — the dedicated, comprehensive DAG view over the WHOLE board: status-colored nodes (column × live session),
 * dependency edges in build order (from → to), pan (drag) + zoom (wheel), and CYCLE edges marked loud (red, dashed) —
 * a cycle is a planning bug the operator should see, not a line to hide. The kanban board keeps the LEAN treatment
 * (§5.BC overlay toggle); this is the complete picture. 2026-09-04 (David: "make the dag view just look like the
 * other mode tabs"): it renders INLINE as the Graph mode of the zoom bar — no full-screen overlay, no far-corner
 * close, leaving is picking another mode. The pure layout + cycle-detection model lives in `board-dag-model.ts`
 * (unit-tested); this file is the SVG view + pan/zoom over it.
 */

const { nodeW: NODE_W, nodeH: NODE_H } = DAG_LAYOUT;
/** Pointer movement (px) below which a gesture is still a CLICK, not a pan — see the onPointerDown note. */
const DRAG_SLOP_PX = 4;

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
	columns,
	dependencies,
	sessions,
	onSelectCard,
}: {
	columns: readonly BoardColumnModel[];
	dependencies: readonly BoardDependency[];
	sessions: Record<string, RuntimeTaskSessionSummary>;
	onSelectCard: (cardId: string) => void;
}): React.ReactElement {
	// Pan/zoom: a viewBox transform driven by pointer drag + wheel.
	const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
	const dragRef = useRef<{
		startX: number;
		startY: number;
		originX: number;
		originY: number;
		/** True once the gesture passed the slop threshold and became a real pan (capture is taken then, not before). */
		capturing: boolean;
	} | null>(null);

	// F2.31 flow direction: early-right is David's 2026-09-02 directive; the toggle keeps the 2026-07-10
	// board-aligned early-left one click away (the two directives conflict — both stay reachable).
	const [flowDirection, setFlowDirection] = useState<DagFlowDirection>("early-right");
	const graph = useMemo(
		() => buildDagGraph(columns, dependencies, sessions, { flowDirection }),
		[columns, dependencies, sessions, flowDirection],
	);

	const viewW = graph.width / view.scale;
	const viewH = graph.height / view.scale;

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col bg-surface-0" data-testid="board-dag-view">
			<div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-1 px-4 py-1.5">
				<span className="text-[11.5px] text-text-tertiary">
					{graph.nodes.length} cards · {graph.edges.length} edges
					{graph.cycleEdgeIds.size > 0 ? (
						<span className="ml-1 text-status-red">· {graph.cycleEdgeIds.size} cycle edge(s)!</span>
					) : null}
				</span>
				<button
					type="button"
					data-testid="board-dag-flow-toggle"
					aria-label="Toggle flow direction"
					title={
						flowDirection === "early-right"
							? "Early work on the right (click for early-left)"
							: "Early work on the left (click for early-right)"
					}
					onClick={() => setFlowDirection((current) => (current === "early-right" ? "early-left" : "early-right"))}
					className="ml-auto rounded-md px-2 py-1 text-[11px] text-text-tertiary hover:bg-surface-3 hover:text-text-primary"
				>
					{flowDirection === "early-right" ? "early → right" : "early → left"}
				</button>
			</div>
			<div className="relative min-h-0 flex-1 overflow-hidden">
				{graph.nodes.length > 0 && graph.edges.length === 0 ? (
					// A board can have cards but no dependency EDGES — a flat decompose (common with weaker local
					// models) or a genuinely parallel plan. Without this hint the vertical stack of nodes reads as a
					// broken graph; say plainly there are no ordering constraints so the layout is expected. Anchored
					// in the left gutter (nodes stack in a centered column) so it never overlaps a card.
					<div className="pointer-events-none absolute left-6 top-1/2 z-10 max-w-[15rem] -translate-y-1/2">
						<div className="rounded-lg border border-border bg-surface-2/90 px-3 py-2 text-[11.5px] leading-snug text-text-tertiary">
							<span className="block font-medium text-text-secondary">No dependency edges</span>
							These cards have no ordering constraints between them — they can run in any order.
						</div>
					</div>
				) : null}
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
							// LIVE-FOUND 2026-07-19 (F2.16 Playwright pass): capturing the pointer HERE stole the click
							// from the nodes — the browser retargets the click to the capturing element, so a node's
							// onClick never fired and clicking a card in the graph did nothing for a real user (a
							// synthetic dispatchEvent("click") worked, which is what isolated it). Capture is now
							// deferred to the first real MOVE below, so a plain click reaches the node and panning is
							// unchanged.
							dragRef.current = {
								startX: event.clientX,
								startY: event.clientY,
								originX: view.x,
								originY: view.y,
								capturing: false,
							};
						}}
						onPointerMove={(event) => {
							const drag = dragRef.current;
							if (!drag) {
								return;
							}
							if (!drag.capturing) {
								// Only a movement past the slop threshold is a pan; below it the gesture is still a click.
								const movedX = Math.abs(event.clientX - drag.startX);
								const movedY = Math.abs(event.clientY - drag.startY);
								if (movedX < DRAG_SLOP_PX && movedY < DRAG_SLOP_PX) {
									return;
								}
								drag.capturing = true;
								event.currentTarget.setPointerCapture(event.pointerId);
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
						{(() => {
							// EXECUTION-ORDER flow (David 2026-07-10): `from` depends on `to`, so the line runs
							// blocker → dependent with the arrow-dot at the dependent end ("what runs next").
							// Overlap minimization (David 2026-09-04 "minimize overlapping edges"):
							//  1. Connection SIDES face the other endpoint (under early-right the mirrored layout made
							//     every edge exit the far side and double back across its own node).
							//  2. PORT FAN-OUT — a node's edges spread along its side (sorted by the far end's y)
							//     instead of all fusing at the vertical center.
							//  3. Long edges follow their model-routed WAYPOINTS through empty corridor slots rather
							//     than cutting straight across intermediate layers (spline through graph.edgeRoutes).
							interface EdgePoints {
								edge: BoardDependency;
								points: { x: number; y: number }[];
							}
							const drawable: EdgePoints[] = [];
							const sidePorts = new Map<string, { edgeId: string; adjacentY: number }[]>();
							const sideKey = (taskId: string, side: "left" | "right"): string => `${taskId}:${side}`;
							for (const edge of graph.edges) {
								const blocker = graph.positions.get(edge.toTaskId);
								const dependent = graph.positions.get(edge.fromTaskId);
								if (!blocker || !dependent) {
									continue;
								}
								const route = graph.edgeRoutes.get(edge.id) ?? [];
								const firstMid = route[0] ?? {
									x: dependent.x + NODE_W / 2,
									y: dependent.y + NODE_H / 2,
								};
								const lastMid = route[route.length - 1] ?? {
									x: blocker.x + NODE_W / 2,
									y: blocker.y + NODE_H / 2,
								};
								const blockerSide: "left" | "right" = firstMid.x >= blocker.x + NODE_W / 2 ? "right" : "left";
								const dependentSide: "left" | "right" =
									lastMid.x >= dependent.x + NODE_W / 2 ? "right" : "left";
								sidePorts.set(sideKey(edge.toTaskId, blockerSide), [
									...(sidePorts.get(sideKey(edge.toTaskId, blockerSide)) ?? []),
									{ edgeId: edge.id, adjacentY: firstMid.y },
								]);
								sidePorts.set(sideKey(edge.fromTaskId, dependentSide), [
									...(sidePorts.get(sideKey(edge.fromTaskId, dependentSide)) ?? []),
									{ edgeId: edge.id, adjacentY: lastMid.y },
								]);
								drawable.push({ edge, points: [] });
							}
							// Port y-offset per (node side): spread across the node height in adjacent-y order.
							const portY = new Map<string, number>(); // `${edgeId}@${taskId}` -> y
							for (const [key, ports] of sidePorts) {
								const taskId = key.slice(0, key.lastIndexOf(":"));
								const nodeY = graph.positions.get(taskId)?.y ?? 0;
								const sorted = [...ports].sort(
									(a, b) => a.adjacentY - b.adjacentY || a.edgeId.localeCompare(b.edgeId),
								);
								sorted.forEach((port, index) => {
									portY.set(`${port.edgeId}@${taskId}`, nodeY + (NODE_H * (index + 1)) / (sorted.length + 1));
								});
							}
							for (const item of drawable) {
								const { edge } = item;
								const blocker = graph.positions.get(edge.toTaskId);
								const dependent = graph.positions.get(edge.fromTaskId);
								if (!blocker || !dependent) {
									continue;
								}
								const route = graph.edgeRoutes.get(edge.id) ?? [];
								const firstMid = route[0] ?? { x: dependent.x + NODE_W / 2, y: 0 };
								const lastMid = route[route.length - 1] ?? { x: blocker.x + NODE_W / 2, y: 0 };
								const startX = firstMid.x >= blocker.x + NODE_W / 2 ? blocker.x + NODE_W : blocker.x;
								const endX = lastMid.x >= dependent.x + NODE_W / 2 ? dependent.x + NODE_W : dependent.x;
								const startY = portY.get(`${edge.id}@${edge.toTaskId}`) ?? blocker.y + NODE_H / 2;
								const endY = portY.get(`${edge.id}@${edge.fromTaskId}`) ?? dependent.y + NODE_H / 2;
								// A waypoint is a column-center lane point; expand it into an ENTRY + EXIT pair at the
								// column's edges so the edge runs horizontally across the column inside its lane and
								// only bends in the inter-column gap (a single center point put every S-bend ~10px
								// inside the next column — straight through whatever card sat there).
								const expanded: { x: number; y: number }[] = [];
								let cursorX = startX;
								for (const waypoint of route) {
									const entering = waypoint.x >= cursorX ? waypoint.x - NODE_W / 2 : waypoint.x + NODE_W / 2;
									const leaving = waypoint.x >= cursorX ? waypoint.x + NODE_W / 2 : waypoint.x - NODE_W / 2;
									expanded.push({ x: entering, y: waypoint.y }, { x: leaving, y: waypoint.y });
									cursorX = leaving;
								}
								item.points = [{ x: startX, y: startY }, ...expanded, { x: endX, y: endY }];
							}
							return drawable.map(({ edge, points }) => {
								const isCycle = graph.cycleEdgeIds.has(edge.id);
								// Routed long edges travel in lane BUNDLES; at full opacity thirty parallel lanes fuse
								// into a solid band, so they render as soft ribbons and adjacent-layer edges (the local
								// structure a reader follows) stay the visual foreground.
								const isRouted = graph.edgeRoutes.has(edge.id);
								const segments = points
									.slice(1)
									.map((point, index) => {
										const previous = points[index] ?? point;
										const midX = (previous.x + point.x) / 2;
										return `C ${midX} ${previous.y}, ${midX} ${point.y}, ${point.x} ${point.y}`;
									})
									.join(" ");
								const first = points[0] ?? { x: 0, y: 0 };
								const last = points[points.length - 1] ?? first;
								return (
									<g key={edge.id} data-testid={isCycle ? "dag-cycle-edge" : "dag-edge"}>
										<path
											d={`M ${first.x} ${first.y} ${segments}`}
											fill="none"
											stroke={isCycle ? "var(--color-status-red)" : "var(--color-accent)"}
											strokeOpacity={isCycle ? 0.9 : isRouted ? 0.18 : 0.35}
											strokeWidth={isCycle ? 2 : 1.5}
											strokeDasharray={isCycle ? "6 4" : undefined}
										/>
										<circle
											cx={last.x}
											cy={last.y}
											r={2.5}
											fill={isCycle ? "var(--color-status-red)" : "var(--color-accent)"}
										/>
									</g>
								);
							});
						})()}
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
