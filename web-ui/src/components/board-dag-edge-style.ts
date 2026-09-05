import type { BoardDependency } from "@/types";
import type { DagNode } from "./board-dag-model";

/**
 * Edge colour by the STATE OF THE WORK it waits on (David 2026-09-05: "highlight edges to finished work
 * greenish, problem edges red, edges to ongoing started active work blueish"). A dependency edge reads
 * `fromTaskId` waits on `toTaskId`, so the prerequisite (`to`) decides finished/active; a problem on EITHER end
 * (parked, failed session, blocked) paints the edge red because the chain through it is stuck; the critical path
 * keeps its gold so the longest remaining chain still stands out among the blue edges it is made of.
 */
export type DagEdgeStatus = "problem" | "critical" | "finished" | "active" | "pending";

export interface DagEdgeStyle {
	status: DagEdgeStatus;
	stroke: string;
	strokeOpacity: number;
	strokeWidth: number;
	strokeDasharray: string | undefined;
}

export function classifyDagEdge(input: {
	edge: Pick<BoardDependency, "fromTaskId" | "toTaskId">;
	nodeById: ReadonlyMap<string, Pick<DagNode, "columnId" | "running" | "failed">>;
	isCycle: boolean;
	isCritical: boolean;
	isSatisfied: boolean;
}): DagEdgeStatus {
	const prerequisite = input.nodeById.get(input.edge.toTaskId);
	const dependent = input.nodeById.get(input.edge.fromTaskId);
	if (input.isCycle || prerequisite?.failed || dependent?.failed) {
		return "problem";
	}
	if (input.isCritical) {
		return "critical";
	}
	if (input.isSatisfied || prerequisite?.columnId === "completed") {
		return "finished";
	}
	if (
		prerequisite?.running ||
		prerequisite?.columnId === "in_progress" ||
		prerequisite?.columnId === "review" ||
		prerequisite?.columnId === "ready"
	) {
		return "active";
	}
	return "pending";
}

export function dagEdgeStyle(
	status: DagEdgeStatus,
	options: { isRouted: boolean; isSatisfied: boolean; isCycle: boolean },
): DagEdgeStyle {
	switch (status) {
		case "problem":
			return {
				status,
				stroke: "var(--color-status-red)",
				strokeOpacity: 0.9,
				strokeWidth: 2.5,
				strokeDasharray: options.isCycle ? "6 4" : undefined,
			};
		case "critical":
			return {
				status,
				stroke: "var(--color-status-gold)",
				strokeOpacity: 0.95,
				strokeWidth: 2.5,
				strokeDasharray: undefined,
			};
		case "finished":
			return {
				status,
				stroke: "var(--color-status-green)",
				strokeOpacity: options.isSatisfied ? 0.35 : 0.5,
				strokeWidth: 1.5,
				strokeDasharray: options.isSatisfied ? "2 4" : undefined,
			};
		case "active":
			return {
				status,
				stroke: "var(--color-accent)",
				strokeOpacity: options.isRouted ? 0.45 : 0.7,
				strokeWidth: 1.75,
				strokeDasharray: undefined,
			};
		default:
			return {
				status,
				stroke: "var(--color-text-tertiary)",
				strokeOpacity: options.isRouted ? 0.18 : 0.35,
				strokeWidth: 1.5,
				strokeDasharray: undefined,
			};
	}
}
