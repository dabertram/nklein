// §5.BB Zoom 0 — the ACTIVITY MAP's pure composer (user-approved mockup: klein-zoom-levels-2026-07-03.html).
// Derives the "which corner of the project is active" picture from the live board + sessions: cards become
// BUBBLES (state-colored, sized by recent activity), plans become CLUSTERS (labeled, activity-scored), and
// board dependencies become CONNECTIONS (cross-cluster edges marked). Pure and deterministic given `now` —
// the SVG view renders this verbatim, so the whole impression is unit-testable.

import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardCard, BoardColumn, BoardDependency } from "@/types";

export type ActivityBubbleState = "running" | "review" | "waiting" | "done" | "blocked" | "idle";

export interface ActivityBubble {
	id: string;
	title: string;
	state: ActivityBubbleState;
	/** Bubble radius in px — state base + a recent-activity boost. */
	radius: number;
	/** True while a model is actively driving the card (renders the pulse). */
	pulsing: boolean;
	/** Age factor 0..1 for done cards (older ⇒ more faded); 0 for everything else. */
	fade: number;
}

export interface ActivityCluster {
	id: string;
	label: string;
	bubbles: ActivityBubble[];
	/** 0..1 — how much of the cluster is actively worked (drives the halo glow). */
	activity: number;
	runningCount: number;
}

export interface ActivityEdge {
	fromCardId: string;
	toCardId: string;
	crossCluster: boolean;
}

export interface ActivityMap {
	clusters: ActivityCluster[];
	edges: ActivityEdge[];
	totalCards: number;
	runningCount: number;
}

/** Cards not generated from any plan cluster under this label. */
export const UNPLANNED_CLUSTER_ID = "unplanned";

const STATE_BASE_RADIUS: Record<ActivityBubbleState, number> = {
	running: 20,
	review: 16,
	blocked: 15,
	waiting: 13,
	done: 12,
	idle: 12,
};

/** Activity within this window boosts bubble size (a "just worked" card reads bigger). */
const ACTIVITY_BOOST_WINDOW_MS = 3 * 60 * 1000;
const ACTIVITY_BOOST_MAX_PX = 8;
/** Done cards fade over this window (older completions recede from the impression). */
const DONE_FADE_WINDOW_MS = 60 * 60 * 1000;

function bubbleStateFor(
	card: BoardCard,
	columnId: string,
	session: RuntimeTaskSessionSummary | undefined,
): ActivityBubbleState {
	if (session?.state === "running" || session?.state === "queued") {
		return "running";
	}
	if (columnId === "review") {
		return "review";
	}
	if (columnId === "completed") {
		return "done";
	}
	if (card.blockedKind) {
		return "blocked";
	}
	if (columnId === "in_progress") {
		return "waiting"; // in the lane but no live session (held/interrupted/between turns)
	}
	return "idle"; // backlog / planning
}

function clusterKeyFor(card: BoardCard): { id: string; label: string } {
	const slug = card.generatedFromPlan?.planSlug?.trim();
	if (slug) {
		return { id: slug, label: slug.replaceAll(/[-_]+/g, " ") };
	}
	return { id: UNPLANNED_CLUSTER_ID, label: "unplanned" };
}

export interface ComposeActivityMapInput {
	columns: readonly BoardColumn[];
	dependencies: readonly BoardDependency[];
	sessions: Readonly<Record<string, RuntimeTaskSessionSummary>>;
	now: () => number;
}

export function composeActivityMap(input: ComposeActivityMapInput): ActivityMap {
	const nowMs = input.now();
	const clustersById = new Map<string, ActivityCluster>();
	const clusterIdByCardId = new Map<string, string>();
	let totalCards = 0;
	let runningCount = 0;

	for (const column of input.columns) {
		if (column.id === "trash") {
			continue;
		}
		for (const card of column.cards) {
			totalCards += 1;
			const session = input.sessions[card.id];
			const state = bubbleStateFor(card, column.id, session);
			if (state === "running") {
				runningCount += 1;
			}
			const lastActivityAt = Math.max(session?.lastHookAt ?? 0, session?.lastOutputAt ?? 0);
			const sinceActivity = lastActivityAt > 0 ? nowMs - lastActivityAt : Number.POSITIVE_INFINITY;
			const boost =
				sinceActivity < ACTIVITY_BOOST_WINDOW_MS
					? Math.round(ACTIVITY_BOOST_MAX_PX * (1 - sinceActivity / ACTIVITY_BOOST_WINDOW_MS))
					: 0;
			const fade = state === "done" ? Math.min(1, Math.max(0, (nowMs - card.updatedAt) / DONE_FADE_WINDOW_MS)) : 0;
			const bubble: ActivityBubble = {
				id: card.id,
				title: card.title,
				state,
				radius: STATE_BASE_RADIUS[state] + boost,
				pulsing: state === "running" && session?.state === "running",
				fade,
			};
			const { id, label } = clusterKeyFor(card);
			clusterIdByCardId.set(card.id, id);
			const cluster = clustersById.get(id);
			if (cluster) {
				cluster.bubbles.push(bubble);
			} else {
				clustersById.set(id, { id, label, bubbles: [bubble], activity: 0, runningCount: 0 });
			}
		}
	}

	for (const cluster of clustersById.values()) {
		cluster.runningCount = cluster.bubbles.filter((bubble) => bubble.state === "running").length;
		const engaged = cluster.bubbles.filter(
			(bubble) => bubble.state === "running" || bubble.state === "review",
		).length;
		cluster.activity =
			cluster.bubbles.length === 0 ? 0 : Math.min(1, engaged / Math.max(3, cluster.bubbles.length / 1.5));
	}

	const edges: ActivityEdge[] = [];
	for (const dependency of input.dependencies) {
		const fromCluster = clusterIdByCardId.get(dependency.fromTaskId);
		const toCluster = clusterIdByCardId.get(dependency.toTaskId);
		if (!fromCluster || !toCluster) {
			continue; // an endpoint is trashed/unknown — don't draw a dangling line
		}
		edges.push({
			fromCardId: dependency.fromTaskId,
			toCardId: dependency.toTaskId,
			crossCluster: fromCluster !== toCluster,
		});
	}

	// Deterministic order: biggest/most-active clusters first, then by label; bubbles running-first then title.
	const clusters = [...clustersById.values()].sort(
		(left, right) =>
			right.activity - left.activity ||
			right.bubbles.length - left.bubbles.length ||
			left.label.localeCompare(right.label),
	);
	for (const cluster of clusters) {
		cluster.bubbles.sort(
			(left, right) =>
				(left.state === "running" ? 0 : 1) - (right.state === "running" ? 0 : 1) ||
				left.title.localeCompare(right.title),
		);
	}
	return { clusters, edges, totalCards, runningCount };
}
