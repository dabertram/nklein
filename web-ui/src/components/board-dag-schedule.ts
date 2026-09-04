import type { BoardDependency } from "@/types";

/**
 * DAG schedule (David 2026-09-04: "make the dag show observed and estimated durations and eta timestamps ..
 * highlight critical path"). PURE: given the graph's nodes/edges, the runtime's per-task schedule facts
 * (observed attempt time + difficulty label) and the live sessions' start stamps, derive per-node estimate /
 * remaining / finish offsets, the ETA timestamps, and the CRITICAL PATH (the longest remaining chain — the one
 * that bounds the whole board's finish). The model is deliberately simple and honest about it: SEQUENTIAL
 * critical path over remaining work (concurrency shortens everything else, never the critical chain), estimates
 * from the difficulty label first and the board's own observed median second, and a "≈" on anything estimated.
 */

export interface DagScheduleNodeInput {
	readonly id: string;
	readonly columnId: string;
	readonly running: boolean;
}

export interface DagScheduleTaskFact {
	readonly observedMs: number | null;
	readonly difficulty: string | null;
	readonly lastCompletedAt: number | null;
}

export interface DagScheduleInput {
	readonly nodes: readonly DagScheduleNodeInput[];
	readonly edges: readonly BoardDependency[];
	/** Per task id: observed attempt time + difficulty (from runtime.getBoardSchedule). */
	readonly facts: ReadonlyMap<string, DagScheduleTaskFact>;
	/** Per task id: the live session's startedAt (running cards' elapsed time). */
	readonly sessionStartedAt: ReadonlyMap<string, number | null | undefined>;
	readonly now: number;
}

export interface DagNodeSchedule {
	/** Estimated total duration for the card (ms); observed when the card is done. */
	readonly estimateMs: number;
	/** True when `estimateMs` is a prior (label/median), false when it is the observed time of a finished card. */
	readonly estimated: boolean;
	/** Work still ahead for this card (0 when done). */
	readonly remainingMs: number;
	/** Offset from `now` at which the card can finish, honoring its blockers (sequential critical path). */
	readonly finishOffsetMs: number;
	/** Absolute ETA (ms epoch) — `now + finishOffsetMs`; null for finished cards. */
	readonly etaAt: number | null;
	/** Elapsed on the current session (running cards only). */
	readonly elapsedMs: number | null;
	readonly onCriticalPath: boolean;
}

export interface DagSchedule {
	readonly byNodeId: ReadonlyMap<string, DagNodeSchedule>;
	readonly criticalNodeIds: ReadonlySet<string>;
	readonly criticalEdgeIds: ReadonlySet<string>;
	/** The whole board's finish (max finish offset) — null when nothing remains. */
	readonly boardFinishOffsetMs: number | null;
	readonly boardEtaAt: number | null;
	/** How the estimates were sourced, for the legend. */
	readonly estimateBasis: "observed-median" | "difficulty-labels" | "defaults";
}

/** Prior durations per §5.AB difficulty label (ms) — the fleet's 27B-class pace on the depth-bed cards. */
export const DIFFICULTY_ESTIMATE_MS: Readonly<Record<string, number>> = {
	trivial: 5 * 60_000,
	easy: 10 * 60_000,
	medium: 20 * 60_000,
	hard: 40 * 60_000,
	"very-hard": 75 * 60_000,
};

export const DEFAULT_ESTIMATE_MS = 20 * 60_000;

function median(values: readonly number[]): number | null {
	if (values.length === 0) {
		return null;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const low = sorted[mid - 1];
	const high = sorted[mid];
	if (high === undefined) {
		return null;
	}
	return sorted.length % 2 === 0 && low !== undefined ? (low + high) / 2 : high;
}

export function computeDagSchedule(input: DagScheduleInput): DagSchedule {
	const { nodes, edges, facts, sessionStartedAt, now } = input;
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	// Observed median of FINISHED cards on this board — the board's own pace beats a global prior.
	const finishedObserved = nodes
		.filter((node) => node.columnId === "completed")
		.map((node) => facts.get(node.id)?.observedMs ?? null)
		.filter((value): value is number => value !== null && value > 0);
	const boardMedianMs = median(finishedObserved);
	let usedLabels = false;
	const estimateFor = (node: DagScheduleNodeInput): { estimateMs: number; estimated: boolean } => {
		const fact = facts.get(node.id);
		if (
			node.columnId === "completed" &&
			fact?.observedMs !== null &&
			fact?.observedMs !== undefined &&
			fact.observedMs > 0
		) {
			return { estimateMs: fact.observedMs, estimated: false };
		}
		const label = fact?.difficulty ?? null;
		if (label && DIFFICULTY_ESTIMATE_MS[label] !== undefined) {
			usedLabels = true;
			return { estimateMs: DIFFICULTY_ESTIMATE_MS[label] ?? DEFAULT_ESTIMATE_MS, estimated: true };
		}
		return { estimateMs: boardMedianMs ?? DEFAULT_ESTIMATE_MS, estimated: true };
	};
	const estimate = new Map<string, { estimateMs: number; estimated: boolean }>();
	const remaining = new Map<string, number>();
	const elapsed = new Map<string, number | null>();
	for (const node of nodes) {
		const est = estimateFor(node);
		estimate.set(node.id, est);
		if (node.columnId === "completed" || node.columnId === "trash") {
			remaining.set(node.id, 0);
			elapsed.set(node.id, null);
			continue;
		}
		const startedAt = sessionStartedAt.get(node.id) ?? null;
		const elapsedMs = node.running && startedAt ? Math.max(0, now - startedAt) : null;
		elapsed.set(node.id, elapsedMs);
		// A running card keeps at least 15% of its estimate ahead: overrunning cards must not read as "due now".
		remaining.set(
			node.id,
			elapsedMs !== null ? Math.max(est.estimateMs - elapsedMs, est.estimateMs * 0.15) : est.estimateMs,
		);
	}
	// Blockers: `from` depends on `to` ⇒ finish(from) = remaining(from) + max(finish(to)). Cycle-guarded.
	const blockersOf = new Map<string, { id: string; edgeId: string }[]>();
	for (const edge of edges) {
		if (!nodeById.has(edge.fromTaskId) || !nodeById.has(edge.toTaskId) || edge.fromTaskId === edge.toTaskId) {
			continue;
		}
		blockersOf.set(edge.fromTaskId, [
			...(blockersOf.get(edge.fromTaskId) ?? []),
			{ id: edge.toTaskId, edgeId: edge.id },
		]);
	}
	const finish = new Map<string, number>();
	const criticalPredecessor = new Map<string, { id: string; edgeId: string } | null>();
	const visiting = new Set<string>();
	const finishOf = (id: string): number => {
		const cached = finish.get(id);
		if (cached !== undefined) {
			return cached;
		}
		if (visiting.has(id)) {
			return 0; // cycle guard — a cycle edge contributes nothing (drawn loud elsewhere)
		}
		visiting.add(id);
		let best = 0;
		let bestPredecessor: { id: string; edgeId: string } | null = null;
		for (const blocker of blockersOf.get(id) ?? []) {
			const blockerFinish = finishOf(blocker.id);
			if (blockerFinish > best) {
				best = blockerFinish;
				bestPredecessor = blocker;
			}
		}
		visiting.delete(id);
		const value = (remaining.get(id) ?? 0) + best;
		finish.set(id, value);
		criticalPredecessor.set(id, bestPredecessor);
		return value;
	};
	for (const node of nodes) {
		finishOf(node.id);
	}
	// Critical path: walk back from the node with the largest finish through its critical predecessors.
	let sinkId: string | null = null;
	let sinkFinish = 0;
	for (const node of nodes) {
		const value = finish.get(node.id) ?? 0;
		if (value > sinkFinish || (value === sinkFinish && sinkId !== null && node.id < sinkId && value > 0)) {
			sinkFinish = value;
			sinkId = node.id;
		}
	}
	const criticalNodeIds = new Set<string>();
	const criticalEdgeIds = new Set<string>();
	let cursor = sinkId;
	while (cursor && !criticalNodeIds.has(cursor)) {
		criticalNodeIds.add(cursor);
		const predecessor = criticalPredecessor.get(cursor) ?? null;
		if (!predecessor) {
			break;
		}
		criticalEdgeIds.add(predecessor.edgeId);
		cursor = predecessor.id;
	}
	const byNodeId = new Map<string, DagNodeSchedule>();
	for (const node of nodes) {
		const est = estimate.get(node.id) ?? { estimateMs: DEFAULT_ESTIMATE_MS, estimated: true };
		const remainingMs = remaining.get(node.id) ?? 0;
		const finishOffsetMs = finish.get(node.id) ?? 0;
		const done = node.columnId === "completed" || node.columnId === "trash";
		byNodeId.set(node.id, {
			estimateMs: est.estimateMs,
			estimated: est.estimated,
			remainingMs,
			finishOffsetMs,
			etaAt: done ? null : now + finishOffsetMs,
			elapsedMs: elapsed.get(node.id) ?? null,
			onCriticalPath: criticalNodeIds.has(node.id),
		});
	}
	return {
		byNodeId,
		criticalNodeIds,
		criticalEdgeIds,
		boardFinishOffsetMs: sinkFinish > 0 ? sinkFinish : null,
		boardEtaAt: sinkFinish > 0 ? now + sinkFinish : null,
		estimateBasis: boardMedianMs !== null ? "observed-median" : usedLabels ? "difficulty-labels" : "defaults",
	};
}

/** Compact duration text: 45s · 12m · 1h05 · 2d3h. */
export function formatDurationShort(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}
	const minutes = Math.round(totalSeconds / 60);
	if (minutes < 60) {
		return `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	const restMinutes = minutes % 60;
	if (hours < 24) {
		return `${hours}h${String(restMinutes).padStart(2, "0")}`;
	}
	const days = Math.floor(hours / 24);
	return `${days}d${hours % 24}h`;
}

/** Wall-clock ETA text: same-day → HH:MM, otherwise Mon HH:MM. */
export function formatEtaClock(etaAt: number, now: number): string {
	const eta = new Date(etaAt);
	const today = new Date(now);
	const hhmm = `${String(eta.getHours()).padStart(2, "0")}:${String(eta.getMinutes()).padStart(2, "0")}`;
	if (eta.toDateString() === today.toDateString()) {
		return hhmm;
	}
	return `${eta.toLocaleDateString(undefined, { weekday: "short" })} ${hhmm}`;
}
