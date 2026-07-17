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
	/**
	 * Density-aware labeling: inside a CLUSTER with more than {@link MAP_CLUSTER_LABEL_LIMIT} bubbles only ACTIVE
	 * bubbles keep their label — overlapping captions read as ink soup. The trigger is per-cluster, not per-board:
	 * a 19-card board with 18 bubbles in one cluster collides even though the total is small (live-found 2026-07-10,
	 * an all-done single-stream project stacked 18 unreadable captions), whereas the same 19 cards spread over small
	 * separate clusters do not — so density must be measured where the labels actually crowd each other.
	 */
	showLabel: boolean;
}

/**
 * Above this many bubbles IN A SINGLE CLUSTER, idle cards drop their captions (hover/selection still reveals them,
 * and zooming into the cluster shows every title). Sized so typical small streams stay fully labeled while a dense
 * stream declutters to just its live/review/blocked bubbles.
 */
export const MAP_CLUSTER_LABEL_LIMIT = 9;

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
	// F12.52: a parked/escalated review card needs the OPERATOR — it must read gold ("waiting / held"),
	// never blend into ordinary purple in-review (the overview previously hid the one signal that matters).
	if (card.review?.status === "parked" || card.review?.escalated === true) {
		return "waiting";
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
				showLabel: true,
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
	for (const cluster of clusters) {
		// Per-cluster: a sparse cluster keeps every caption; a crowded one keeps only its ACTIVE bubbles' captions
		// (idle titles still surface on hover and when the cluster is zoomed into).
		if (cluster.bubbles.length <= MAP_CLUSTER_LABEL_LIMIT) {
			continue;
		}
		for (const bubble of cluster.bubbles) {
			bubble.showLabel =
				bubble.pulsing || bubble.state === "running" || bubble.state === "review" || bubble.state === "blocked";
		}
	}
	return { clusters, edges, totalCards, runningCount };
}

// --- bubble-label collision layout (pure; rendered by activity-map-view) -----------------------------------------------

/** One label the view wants to draw: bubble center, radius, caption, and the ring-parity preferred side. */
export interface BubbleLabelCandidate {
	readonly id: string;
	readonly x: number;
	readonly y: number;
	readonly radius: number;
	readonly caption: string;
	readonly preferAbove: boolean;
}

export interface BubbleLabelPlacement {
	readonly above: boolean;
	/** True when no side fits without overprinting an already-placed label — the view falls back to hover-title. */
	readonly hidden: boolean;
}

/** Keep in sync with the view's caption font (10px): approximate glyph advance + label line height. */
const LABEL_CHAR_PX = 5.1;
const LABEL_LINE_PX = 12;

interface LabelRect {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

/**
 * Resolve bubble-label placement with a GLOBAL greedy collision pass. Ring-parity staggering alone still let two
 * labels from different rings land on one line and overprint ("Expand tests fo…" ran into "Document model an…",
 * live-found 2026-07-17) — parity only alternates within a ring, so cross-ring neighbors can agree on a side.
 *
 * Deterministic: candidates are placed in reading order (y, then x, then id). Each label first tries its preferred
 * side; on overlap it flips to the bubble's other side; if both sides overprint an already-placed label it is
 * hidden (the bubble keeps its hover <title>). Uses the same char-width + edge-clamp math as the renderer so the
 * tested rects match what is actually drawn.
 */
export function resolveBubbleLabelLayout(
	candidates: readonly BubbleLabelCandidate[],
	canvasWidth: number,
): Map<string, BubbleLabelPlacement> {
	const placedRects: LabelRect[] = [];
	const layout = new Map<string, BubbleLabelPlacement>();

	const rectFor = (candidate: BubbleLabelCandidate, above: boolean): LabelRect => {
		const halfWidth = (candidate.caption.length * LABEL_CHAR_PX) / 2;
		const clampedX = Math.min(Math.max(candidate.x, halfWidth + 4), canvasWidth - halfWidth - 4);
		const baseline = above ? candidate.y - candidate.radius - 6 : candidate.y + candidate.radius + 13;
		return { x1: clampedX - halfWidth, y1: baseline - LABEL_LINE_PX + 2, x2: clampedX + halfWidth, y2: baseline + 2 };
	};
	const collides = (rect: LabelRect): boolean =>
		placedRects.some(
			(other) =>
				rect.x1 < other.x2 + 6 && other.x1 < rect.x2 + 6 && rect.y1 < other.y2 + 2 && other.y1 < rect.y2 + 2,
		);

	const ordered = [...candidates].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
	for (const candidate of ordered) {
		const preferred = rectFor(candidate, candidate.preferAbove);
		if (!collides(preferred)) {
			placedRects.push(preferred);
			layout.set(candidate.id, { above: candidate.preferAbove, hidden: false });
			continue;
		}
		const flipped = rectFor(candidate, !candidate.preferAbove);
		if (!collides(flipped)) {
			placedRects.push(flipped);
			layout.set(candidate.id, { above: !candidate.preferAbove, hidden: false });
			continue;
		}
		layout.set(candidate.id, { above: candidate.preferAbove, hidden: true });
	}
	return layout;
}
