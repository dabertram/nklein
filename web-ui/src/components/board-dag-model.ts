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

/**
 * What a node MEANS, in one line: its title, the lane it sits in, whether it is running or failed, and whether it
 * is on the critical path.
 *
 * P0.AUDIT0904 leg 23. The node's `aria-label` was the bare title, and colour carried everything else — so a
 * screen-reader user was told "Add the ledger schema" and nothing about whether it had failed, and a sighted user
 * had to learn a five-colour key to read the same. Colour is a fine ACCELERATOR and a poor sole channel.
 */
export function describeDagNode(node: DagNode, options: { onCriticalPath: boolean }): string {
	const state = node.failed ? "failed" : node.running ? "running" : LANE_LABEL[node.columnId];
	return `${node.title} — ${state}${options.onCriticalPath ? ", on the critical path" : ""}`;
}

const LANE_LABEL: Record<BoardColumnId, string> = {
	backlog: "in backlog",
	planning: "in planning",
	ready: "ready",
	in_progress: "in progress",
	review: "in review",
	completed: "completed",
	trash: "in trash",
};

export interface DagGraph {
	nodes: DagNode[];
	edges: BoardDependency[];
	positions: Map<string, { x: number; y: number }>;
	/**
	 * Waypoint centers for edges spanning MORE than one layer (F2.31 follow-up, David 2026-09-04 "minimize
	 * overlapping edges"): long edges are threaded through virtual slots in every intermediate layer — they
	 * participate in the crossing-minimization ordering and the view draws the spline through these points
	 * instead of cutting straight across other layers' nodes. Keyed by edge id; adjacent-layer edges absent.
	 */
	edgeRoutes: Map<string, { x: number; y: number }[]>;
	cycleEdgeIds: Set<string>;
	/**
	 * Edges retired into `board.satisfiedDependencies` (their blocker landed). Rendered dimmed/dashed so finished
	 * work keeps its place in the structure (David 2026-09-04: "deps for finished cards might help") — they take
	 * part in layering, so a completed prerequisite sits upstream of its dependents instead of floating loose.
	 */
	satisfiedEdgeIds: Set<string>;
	/** Wrapped title lines per node (never truncated) and the resulting per-node box heights. */
	titleLines: Map<string, string[]>;
	nodeHeights: Map<string, number>;
	width: number;
	height: number;
}

/** Node box + gap geometry (px). Exported so the view and its tests share one source of truth. */
export const DAG_LAYOUT = {
	nodeW: 168,
	/** Height of a ONE-line node (title line + schedule line); every extra title line adds `lineH`. */
	nodeH: 44,
	lineH: 13,
	/** Characters that fit one title line at the node's 11px font inside its 12px padding. */
	titleCharsPerLine: 22,
	gapX: 64,
	gapY: 18,
	pad: 28,
	lanePx: 8,
	laneGapPx: 6,
} as const;

/**
 * Word-wrap a card title into lines that fit the node width (David 2026-09-05: "truncation avoidance
 * everywhere, especially cards and dag cards") — the whole title is always shown; a single over-long word is
 * hard-split rather than clipped.
 */
export function wrapDagTitle(title: string, maxChars: number = DAG_LAYOUT.titleCharsPerLine): string[] {
	const words = title.trim().split(/\s+/u).filter(Boolean);
	const lines: string[] = [];
	let current = "";
	for (const rawWord of words) {
		let word = rawWord;
		while (word.length > maxChars) {
			if (current) {
				lines.push(current);
				current = "";
			}
			lines.push(word.slice(0, maxChars));
			word = word.slice(maxChars);
		}
		if (!current) {
			current = word;
		} else if (current.length + 1 + word.length <= maxChars) {
			current = `${current} ${word}`;
		} else {
			lines.push(current);
			current = word;
		}
	}
	if (current) {
		lines.push(current);
	}
	return lines.length > 0 ? lines : [""];
}

/** A node's box height: one-line base plus one `lineH` per extra wrapped title line. */
export function dagNodeHeight(titleLineCount: number): number {
	return DAG_LAYOUT.nodeH + Math.max(0, titleLineCount - 1) * DAG_LAYOUT.lineH;
}

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
	options: { flowDirection?: DagFlowDirection; satisfiedDependencies?: readonly BoardDependency[] } = {},
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
					// A parked review is a problem too (David 2026-09-05: "problem edges red") — the chain through it is stuck.
					failed:
						sessions[card.id]?.state === "failed" || card.blockedKind != null || card.review?.status === "parked",
				})),
	);
	const ids = nodes.map((node) => node.id);
	const titleLines = new Map(nodes.map((node) => [node.id, wrapDagTitle(node.title)]));
	const nodeHeights = new Map(nodes.map((node) => [node.id, dagNodeHeight(titleLines.get(node.id)?.length ?? 1)]));
	const idSet = new Set(ids);
	const liveIds = new Set(dependencies.map((edge) => edge.id));
	const satisfied = (options.satisfiedDependencies ?? []).filter((edge) => !liveIds.has(edge.id));
	const satisfiedEdgeIds = new Set(satisfied.map((edge) => edge.id));
	const edges = [...dependencies, ...satisfied].filter(
		(edge) => idSet.has(edge.fromTaskId) && idSet.has(edge.toTaskId),
	);
	const dependsOn = new Map<string, string[]>();
	for (const edge of edges) {
		// Core semantics (task-board-ready-sweep.ts): `from` DEPENDS ON `to` — `to` must land first. Depth flows
		// along build order, so BLOCKERS layer LEFT and dependents RIGHT (this was reversed — live-found by David
		// 2026-07-10: the graph read against the board's left→right time flow).
		dependsOn.set(edge.fromTaskId, [...(dependsOn.get(edge.fromTaskId) ?? []), edge.toTaskId]);
	}
	const depths = computeDepths(ids, dependsOn);
	const cycleEdgeIds = findCycleEdgeIds(ids, edges);
	const maxDepth = Math.max(0, ...[...depths.values()]);
	// ── Layered layout with VIRTUAL waypoints (David 2026-09-04: "minimize overlapping edges .. user needs
	// visual structure"). An edge spanning more than one layer is split into segments through a virtual item
	// per intermediate layer, so long edges (a) take part in crossing minimization instead of being invisible
	// to it and (b) render through empty corridor slots instead of straight across other layers' nodes.
	type LayerItem = { key: string; nodeId?: string; edgeId?: string };
	const layers: LayerItem[][] = Array.from({ length: maxDepth + 1 }, () => []);
	for (const node of nodes) {
		layers[depths.get(node.id) ?? 0]?.push({ key: node.id, nodeId: node.id });
	}
	// Segment adjacency between CONSECUTIVE layers (real edges split by virtuals). Self/cycle-safe: segments
	// are only created along ascending depth, so a cycle's back edge simply gets no route (drawn direct, loud).
	const segmentsUp = new Map<string, string[]>(); // item key (depth d) -> item keys at depth d+1
	const segmentsDown = new Map<string, string[]>(); // item key (depth d) -> item keys at depth d-1
	const virtualKeysByEdge = new Map<string, string[]>();
	const link = (lowerKey: string, upperKey: string): void => {
		segmentsUp.set(lowerKey, [...(segmentsUp.get(lowerKey) ?? []), upperKey]);
		segmentsDown.set(upperKey, [...(segmentsDown.get(upperKey) ?? []), lowerKey]);
	};
	for (const edge of edges) {
		// Build order: `from` depends on `to` ⇒ `to` (blocker) sits at the LOWER depth.
		const blockerDepth = depths.get(edge.toTaskId) ?? 0;
		const dependentDepth = depths.get(edge.fromTaskId) ?? 0;
		if (dependentDepth <= blockerDepth) {
			continue; // flat or back edge (cycle) — no segments, rendered as a direct line by the view
		}
		let previousKey = edge.toTaskId;
		const waypointKeys: string[] = [];
		for (let depth = blockerDepth + 1; depth < dependentDepth; depth += 1) {
			const virtualKey = `virtual:${edge.id}:${depth}`;
			layers[depth]?.push({ key: virtualKey, edgeId: edge.id });
			waypointKeys.push(virtualKey);
			link(previousKey, virtualKey);
			previousKey = virtualKey;
		}
		link(previousKey, edge.fromTaskId);
		if (waypointKeys.length > 0) {
			virtualKeysByEdge.set(edge.id, waypointKeys);
		}
	}
	// ── Crossing minimization: iterated barycenter sweeps + adjacent-transpose, keeping the BEST ordering seen
	// (counted, not assumed — a sweep can regress on hairball graphs). Deterministic: stable sorts, index ties.
	const indexOf = new Map<string, number>();
	const reindex = (): void => {
		for (const layer of layers) {
			layer.forEach((item, index) => {
				indexOf.set(item.key, index);
			});
		}
	};
	reindex();
	const crossingsBetween = (lower: readonly LayerItem[]): number => {
		// Count inversions among segment endpoints from this layer to the next (O(k²) — layers are small).
		const targetRows: number[][] = lower.map((item) =>
			(segmentsUp.get(item.key) ?? []).map((key) => indexOf.get(key) ?? 0).sort((a, b) => a - b),
		);
		let crossings = 0;
		for (let a = 0; a < targetRows.length; a += 1) {
			for (let b = a + 1; b < targetRows.length; b += 1) {
				for (const upperA of targetRows[a] ?? []) {
					for (const upperB of targetRows[b] ?? []) {
						if (upperA > upperB) {
							crossings += 1;
						}
					}
				}
			}
		}
		return crossings;
	};
	const totalCrossings = (): number => layers.reduce((sum, layer) => sum + crossingsBetween(layer), 0);
	const sweep = (anchorsOf: (key: string) => readonly string[], order: readonly number[]): void => {
		for (const depth of order) {
			const layer = layers[depth];
			if (!layer || layer.length < 2) {
				continue;
			}
			const mean = (item: LayerItem): number => {
				const anchors = anchorsOf(item.key)
					.map((key) => indexOf.get(key))
					.filter((value): value is number => value !== undefined);
				return anchors.length === 0
					? (indexOf.get(item.key) ?? 0)
					: anchors.reduce((a, b) => a + b, 0) / anchors.length;
			};
			layers[depth] = [...layer].sort((a, b) => mean(a) - mean(b));
			reindex();
		}
	};
	const transpose = (): void => {
		// Local search: swap adjacent items when it strictly reduces crossings around that layer.
		for (let pass = 0; pass < 2; pass += 1) {
			let improved = false;
			for (let depth = 0; depth <= maxDepth; depth += 1) {
				const layer = layers[depth];
				if (!layer || layer.length < 2) {
					continue;
				}
				const localCost = (): number =>
					crossingsBetween(layer) + (depth > 0 ? crossingsBetween(layers[depth - 1] ?? []) : 0);
				for (let index = 0; index + 1 < layer.length; index += 1) {
					const before = localCost();
					const left = layer[index];
					const right = layer[index + 1];
					if (!left || !right) {
						continue;
					}
					layer[index] = right;
					layer[index + 1] = left;
					reindex();
					if (localCost() >= before) {
						layer[index] = left;
						layer[index + 1] = right;
						reindex();
					} else {
						improved = true;
					}
				}
			}
			if (!improved) {
				break;
			}
		}
	};
	const upOrder = Array.from({ length: maxDepth }, (_, i) => i + 1);
	const downOrder = Array.from({ length: maxDepth }, (_, i) => maxDepth - 1 - i);
	let bestOrdering = layers.map((layer) => [...layer]);
	let bestCrossings = totalCrossings();
	for (let round = 0; round < 4 && bestCrossings > 0; round += 1) {
		sweep((key) => segmentsDown.get(key) ?? [], upOrder);
		sweep((key) => segmentsUp.get(key) ?? [], downOrder);
		transpose();
		const crossings = totalCrossings();
		if (crossings < bestCrossings) {
			bestCrossings = crossings;
			bestOrdering = layers.map((layer) => [...layer]);
		}
	}
	for (let depth = 0; depth <= maxDepth; depth += 1) {
		layers[depth] = bestOrdering[depth] ?? [];
	}
	reindex();
	// ── Positions: virtual waypoints occupy thin LANES (edge corridors, not card slots) so long edges get
	// clean, distinct lanes without ballooning the column height (a half-row per lane made a 216-edge
	// board's middle layers a 600px waterfall). Real nodes keep the full box; y is accumulated per layer.
	const positions = new Map<string, { x: number; y: number }>();
	const waypointCenters = new Map<string, { x: number; y: number }>();
	let tallestLayerPx = 0;
	for (let depth = 0; depth <= maxDepth; depth += 1) {
		const columnIndex = flowDirection === "early-right" ? maxDepth - depth : depth;
		const x = pad + columnIndex * (nodeW + gapX);
		let y = pad;
		let previousWasNode = false;
		for (const item of layers[depth] ?? []) {
			if (item.nodeId) {
				positions.set(item.nodeId, { x, y });
				y += (nodeHeights.get(item.nodeId) ?? nodeH) + gapY;
				previousWasNode = true;
			} else {
				if (previousWasNode) {
					y += DAG_LAYOUT.laneGapPx; // breathing room between a card and the corridor under it
				}
				waypointCenters.set(item.key, { x: x + nodeW / 2, y: y + DAG_LAYOUT.lanePx / 2 });
				y += DAG_LAYOUT.lanePx;
				previousWasNode = false;
			}
		}
		tallestLayerPx = Math.max(tallestLayerPx, y - pad);
	}
	const edgeRoutes = new Map<string, { x: number; y: number }[]>();
	for (const [edgeId, waypointKeys] of virtualKeysByEdge) {
		const route = waypointKeys
			.map((key) => waypointCenters.get(key))
			.filter((point): point is { x: number; y: number } => point !== undefined);
		if (route.length > 0) {
			edgeRoutes.set(edgeId, route);
		}
	}
	const width = pad * 2 + (maxDepth + 1) * (nodeW + gapX) - gapX;
	const height = pad * 2 + Math.max(0, tallestLayerPx - gapY);
	return {
		nodes,
		edges,
		positions,
		edgeRoutes,
		cycleEdgeIds,
		satisfiedEdgeIds,
		titleLines,
		nodeHeights,
		width: Math.max(width, 320),
		height: Math.max(height, 200),
	};
}

/**
 * F2.31b — DAG node SEARCH. Pure so the matching rule is testable without a DOM.
 *
 * What it matches: the card's TITLE, its ID and its PROMPT (a decomposed card is often named by its leaf scope while
 * the words you remember are in the brief). The query is split on whitespace and every term must appear somewhere
 * in that text (case-insensitive substring) — an AND of terms, the least surprising rule for a "find that card" box.
 * Non-matches are DIMMED, never hidden: hiding nodes breaks the edges' meaning, and the tree is the point of the
 * view. The ordered match list drives Enter-to-next so the same query walks the graph in a stable order.
 */
export interface DagSearchResult {
	/** Every matching node id, in the graph's node order. Empty query ⇒ every node matches. */
	readonly matchedIds: ReadonlySet<string>;
	readonly ordered: readonly string[];
	/** True only for a non-empty query — the dimming applies only then. */
	readonly active: boolean;
}

export function searchDagNodes(
	query: string,
	nodes: readonly DagNode[],
	promptById: ReadonlyMap<string, string> = new Map(),
): DagSearchResult {
	const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
	if (terms.length === 0) {
		const all = nodes.map((node) => node.id);
		return { matchedIds: new Set(all), ordered: all, active: false };
	}
	const ordered = nodes
		.filter((node) => {
			const haystack = `${node.title}\n${node.id}\n${promptById.get(node.id) ?? ""}`.toLowerCase();
			return terms.every((term) => haystack.includes(term));
		})
		.map((node) => node.id);
	return { matchedIds: new Set(ordered), ordered, active: true };
}
