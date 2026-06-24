import type React from "react";
import { useMemo } from "react";

/**
 * Renders the task-graph a `decompose_project` tool call proposed as a small visual DAG inside the chat (todo §5.B).
 * Nodes are the proposed cards, edges are their `dependsOn` links, laid out in longest-path layers (roots on top,
 * flowing down). It renders for a *failed* decompose too, so the user can see exactly what graph the agent proposed and
 * where the missing/odd edges are — the planning errors are otherwise invisible. No layout library: a tolerant JSON
 * parse + a layered SVG, defensive against cycles, unknown dependency ids, and malformed input.
 */

interface DecompositionNode {
	id: string;
	title: string;
	dependsOn: string[];
}

const NODE_WIDTH = 150;
const NODE_HEIGHT = 38;
const GAP_X = 22;
const GAP_Y = 44;
const PADDING = 12;
const MAX_TITLE_CHARS = 22;

function parseDecompositionNodes(inputJson: string | null): DecompositionNode[] | null {
	if (!inputJson) {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(inputJson);
	} catch {
		return null;
	}
	const tasks = (parsed as { tasks?: unknown })?.tasks;
	if (!Array.isArray(tasks)) {
		return null;
	}
	const nodes = tasks.flatMap((entry): DecompositionNode[] => {
		const record = entry as { id?: unknown; title?: unknown; dependsOn?: unknown };
		const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;
		if (!id) {
			return [];
		}
		const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : id;
		const dependsOn = Array.isArray(record.dependsOn)
			? record.dependsOn.filter((value): value is string => typeof value === "string")
			: [];
		return [{ id, title, dependsOn }];
	});
	return nodes.length > 0 ? nodes : null;
}

/** Longest-path depth per node (roots = 0), guarding against dependency cycles and self/unknown edges. */
function computeNodeDepths(nodes: DecompositionNode[]): Map<string, number> {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const depthById = new Map<string, number>();
	const inProgress = new Set<string>();

	const depthOf = (id: string): number => {
		const cached = depthById.get(id);
		if (cached !== undefined) {
			return cached;
		}
		if (inProgress.has(id)) {
			return 0; // cycle guard
		}
		inProgress.add(id);
		const deps = (byId.get(id)?.dependsOn ?? []).filter(
			(dependencyId) => dependencyId !== id && byId.has(dependencyId),
		);
		const depth = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(depthOf));
		inProgress.delete(id);
		depthById.set(id, depth);
		return depth;
	};

	for (const node of nodes) {
		depthOf(node.id);
	}
	return depthById;
}

function truncate(text: string): string {
	return text.length > MAX_TITLE_CHARS ? `${text.slice(0, MAX_TITLE_CHARS - 1)}…` : text;
}

export function DecompositionGraphView({
	input,
	hasError = false,
}: {
	input: string | null;
	hasError?: boolean;
}): React.ReactElement | null {
	const layout = useMemo(() => {
		const nodes = parseDecompositionNodes(input);
		if (!nodes) {
			return null;
		}
		const byId = new Map(nodes.map((node) => [node.id, node]));
		const depthById = computeNodeDepths(nodes);
		const maxDepth = Math.max(0, ...depthById.values());
		const layers: DecompositionNode[][] = Array.from({ length: maxDepth + 1 }, () => []);
		for (const node of nodes) {
			layers[depthById.get(node.id) ?? 0]?.push(node);
		}
		const maxNodesInLayer = Math.max(1, ...layers.map((layer) => layer.length));
		const innerWidth = maxNodesInLayer * NODE_WIDTH + (maxNodesInLayer - 1) * GAP_X;
		const width = innerWidth + PADDING * 2;
		const height = layers.length * NODE_HEIGHT + (layers.length - 1) * GAP_Y + PADDING * 2;

		const centerById = new Map<string, { x: number; y: number }>();
		layers.forEach((layer, depth) => {
			const rowWidth = layer.length * NODE_WIDTH + (layer.length - 1) * GAP_X;
			const startX = PADDING + (innerWidth - rowWidth) / 2;
			layer.forEach((node, index) => {
				centerById.set(node.id, {
					x: startX + index * (NODE_WIDTH + GAP_X),
					y: PADDING + depth * (NODE_HEIGHT + GAP_Y),
				});
			});
		});

		const edges = nodes.flatMap((node) =>
			node.dependsOn
				.filter((dependencyId) => dependencyId !== node.id && byId.has(dependencyId))
				.map((dependencyId) => ({ from: dependencyId, to: node.id })),
		);

		return { nodes, layers, centerById, edges, width, height };
	}, [input]);

	if (!layout) {
		return null;
	}

	const { nodes, centerById, edges, width, height } = layout;

	return (
		<div
			className={`rounded-md border bg-surface-0 ${hasError ? "border-status-red/40" : "border-border"}`}
			data-testid="decomposition-graph-view"
		>
			<div className="flex items-center justify-between gap-2 px-2 py-1 text-[11px] text-text-tertiary">
				<span className={hasError ? "text-status-red" : undefined}>
					{hasError ? "Proposed plan graph (failed validation)" : "Proposed plan graph"}
				</span>
				<span>
					{nodes.length} card{nodes.length === 1 ? "" : "s"} · {edges.length} dep{edges.length === 1 ? "" : "s"}
				</span>
			</div>
			<div className="max-h-80 overflow-auto p-1">
				<svg
					width={width}
					height={height}
					viewBox={`0 0 ${width} ${height}`}
					role="img"
					aria-label="Proposed decomposition task graph"
				>
					<title>Proposed decomposition task graph</title>
					{edges.map((edge) => {
						const from = centerById.get(edge.from);
						const to = centerById.get(edge.to);
						if (!from || !to) {
							return null;
						}
						const startX = from.x + NODE_WIDTH / 2;
						const startY = from.y + NODE_HEIGHT;
						const endX = to.x + NODE_WIDTH / 2;
						const endY = to.y;
						const midY = (startY + endY) / 2;
						return (
							<path
								key={`${edge.from}->${edge.to}`}
								d={`M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`}
								fill="none"
								stroke="var(--color-border-bright)"
								strokeWidth={1.5}
							/>
						);
					})}
					{nodes.map((node) => {
						const center = centerById.get(node.id);
						if (!center) {
							return null;
						}
						return (
							<g key={node.id} transform={`translate(${center.x}, ${center.y})`}>
								<title>{`${node.id}: ${node.title}`}</title>
								<rect
									width={NODE_WIDTH}
									height={NODE_HEIGHT}
									rx={6}
									fill="var(--color-surface-2)"
									stroke="var(--color-border-bright)"
									strokeWidth={1}
								/>
								<text
									x={8}
									y={15}
									fill="var(--color-text-primary)"
									fontSize={11}
									fontWeight={600}
									style={{ fontFamily: "inherit" }}
								>
									{truncate(node.title)}
								</text>
								<text
									x={8}
									y={29}
									fill="var(--color-text-tertiary)"
									fontSize={9}
									style={{ fontFamily: "monospace" }}
								>
									{truncate(node.id)}
								</text>
							</g>
						);
					})}
				</svg>
			</div>
		</div>
	);
}
