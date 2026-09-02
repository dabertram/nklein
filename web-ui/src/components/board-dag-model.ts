import type { RuntimeTaskSessionSummary } from "@runtime-contract";
import type { BoardColumnId, BoardColumn as BoardColumnModel, BoardDependency } from "@/types";

/**
 * W3.4 — the PURE model behind the board dependency-graph view (`board-dag-view.tsx`): it turns the board columns +
 * dependency edges + live sessions into laid-out nodes, edges, positions, and the set of cycle edges. Extracted from
 * the component so the correctness-critical bits (longest-path layering with a cycle guard + DFS back-edge cycle
 * detection — the "cycle edges marked loud" feature) are unit-testable without a DOM.
 */

export interface DagNode {
	id: string;
	title: string;
	columnId: BoardColumnId;
	running: boolean;
	failed: boolean;
}

export interface DagGraph {
	nodes: DagNode[];
	edges: BoardDependency[];
	positions: Map<string, { x: number; y: number }>;
	cycleEdgeIds: Set<string>;
	width: number;
	height: number;
}

/** Node box + gap geometry (px). Exported so the view and its tests share one source of truth. */
export const DAG_LAYOUT = { nodeW: 168, nodeH: 44, gapX: 64, gapY: 18, pad: 28 } as const;

/** Longest-path depth per node over the dependency edges (cycle-guarded — a cycle re-entry contributes depth 0). */
export function computeDepths(ids: readonly string[], dependsOn: Map<string, string[]>): Map<string, number> {
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

/** Edges participating in a dependency cycle (DFS back-edge detection) — drawn loud in the view. */
export function findCycleEdgeIds(ids: readonly string[], edges: readonly BoardDependency[]): Set<string> {
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

/**
 * Build the laid-out graph: non-trash cards become nodes (status from their live session), dependency edges are kept
 * only when both endpoints are on the board, depth = longest-path build order (roots at depth 0, flowing right), and
 * nodes stack within their depth column. Cycle edges are detected for the loud rendering.
 */
/** F2.31: which side EARLY work (depth-0 roots, built first) sits on. David 2026-09-02: "early to the right ..
 * late on left side" — `early-right` is the default; `early-left` preserves the 2026-07-10 board-aligned flow
 * as a view toggle (the two directives conflict; the toggle keeps both truths one click apart). */
export type DagFlowDirection = "early-right" | "early-left";

export function buildDagGraph(
	columns: readonly BoardColumnModel[],
	dependencies: readonly BoardDependency[],
	sessions: Record<string, RuntimeTaskSessionSummary>,
	options: { flowDirection?: DagFlowDirection } = {},
): DagGraph {
	const flowDirection: DagFlowDirection = options.flowDirection ?? "early-right";
	const { nodeW, nodeH, gapX, gapY, pad } = DAG_LAYOUT;
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
		// Core semantics (task-board-ready-sweep.ts): `from` DEPENDS ON `to` — `to` must land first. Depth flows
		// along build order, so BLOCKERS layer LEFT and dependents RIGHT (this was reversed — live-found by David
		// 2026-07-10: the graph read against the board's left→right time flow).
		dependsOn.set(edge.fromTaskId, [...(dependsOn.get(edge.fromTaskId) ?? []), edge.toTaskId]);
	}
	const depths = computeDepths(ids, dependsOn);
	const cycleEdgeIds = findCycleEdgeIds(ids, edges);
	// Column-per-depth layout: one column per depth; y = index within the (barycenter-ordered) layer.
	const byDepth = new Map<number, DagNode[]>();
	for (const node of nodes) {
		const depth = depths.get(node.id) ?? 0;
		byDepth.set(depth, [...(byDepth.get(depth) ?? []), node]);
	}
	// F2.31 "tree structure as good as possible": barycenter ordering — order each layer by the mean y-index of
	// its neighbors in the adjacent layer (one forward + one backward sweep). Children group under their parents
	// and edge crossings drop, instead of the arbitrary board-order interleave.
	const maxDepth = Math.max(0, ...byDepth.keys());
	const indexOf = new Map<string, number>();
	const reindex = (layer: readonly DagNode[]): void => {
		layer.forEach((node, index) => {
			indexOf.set(node.id, index);
		});
	};
	for (const layer of byDepth.values()) {
		reindex(layer);
	}
	const neighborMean = (node: DagNode, neighborIds: readonly string[]): number => {
		const anchors = neighborIds.map((id) => indexOf.get(id)).filter((value): value is number => value !== undefined);
		return anchors.length === 0 ? (indexOf.get(node.id) ?? 0) : anchors.reduce((a, b) => a + b, 0) / anchors.length;
	};
	const dependents = new Map<string, string[]>();
	for (const edge of edges) {
		dependents.set(edge.toTaskId, [...(dependents.get(edge.toTaskId) ?? []), edge.fromTaskId]);
	}
	const sortLayer = (depth: number, anchorsFor: (node: DagNode) => readonly string[]): void => {
		const layer = byDepth.get(depth);
		if (!layer || layer.length < 2) {
			return;
		}
		const sorted = [...layer].sort((a, b) => neighborMean(a, anchorsFor(a)) - neighborMean(b, anchorsFor(b)));
		byDepth.set(depth, sorted);
		reindex(sorted);
	};
	for (let depth = 1; depth <= maxDepth; depth += 1) {
		sortLayer(depth, (node) => dependsOn.get(node.id) ?? []); // toward my blockers (previous layer)
	}
	for (let depth = maxDepth - 1; depth >= 0; depth -= 1) {
		sortLayer(depth, (node) => dependents.get(node.id) ?? []); // toward my dependents (next layer)
	}
	const positions = new Map<string, { x: number; y: number }>();
	for (const [depth, layer] of byDepth) {
		// early-right mirrors the depth axis: roots (depth 0, built FIRST) sit in the RIGHTMOST column.
		const columnIndex = flowDirection === "early-right" ? maxDepth - depth : depth;
		layer.forEach((node, index) => {
			positions.set(node.id, { x: pad + columnIndex * (nodeW + gapX), y: pad + index * (nodeH + gapY) });
		});
	}
	const width = pad * 2 + (Math.max(0, ...byDepth.keys()) + 1) * (nodeW + gapX) - gapX;
	const height = pad * 2 + Math.max(0, ...[...byDepth.values()].map((layer) => layer.length)) * (nodeH + gapY) - gapY;
	return { nodes, edges, positions, cycleEdgeIds, width: Math.max(width, 320), height: Math.max(height, 200) };
}
