/**
 * N17 — the COMPLETE lifecycle trail for a card: everything that happened to it, in one ordered timeline.
 *
 * David, 2026-07-20: *"we need to implement complete tracking for every thing that happens to/on a card/task …
 * rather over covered than missing any detail … future debugging as easy as possible by having all the relevant
 * trails already collected."*
 *
 * The motivating cost is measured, not hypothetical. Diagnosing ONE stalled card on 2026-07-20 took hours and
 * required: grepping a runtime log by hand, parsing a seed-monitor log that had to be added mid-investigation,
 * reading board JSON out of a retained HOME, walking a dependency array, and running `git log` in a sandbox
 * workspace. Four hypotheses were raised and three were wrong — **not for want of thinking, but for want of the
 * trail being in one place.**
 *
 * ── WHY THIS AGGREGATES RATHER THAN ADDING A NEW STORE ──
 * A parallel "card events" store would be a second source of truth that DRIFTS from the first. Every emission
 * site would have to remember to write to both, and the day one forgets is the day the trail lies — which is
 * worse than no trail, because a gap reads as "nothing happened".
 *
 * So this merges what is ALREADY recorded — self-observations (task-keyed), the agent ledger (attempts,
 * transitions, scheduler decisions), and the board's own lane history — into one ordered view. Sources it does
 * not know about cannot be silently missing: `sourcesRead` reports exactly which were available and which were
 * absent, so a thin trail is distinguishable from a quiet card.
 *
 * ── THE ORDERING RULE ──
 * Events carry timestamps from different subsystems with different clocks. Ordering is by timestamp, then by a
 * stable source rank, then by insertion — so a trail is deterministic even when two events share a millisecond.
 * A non-deterministic trail would make two debugging sessions on the same data disagree, which is the one thing
 * a forensic tool must never do.
 */

export type TrailSource = "observation" | "ledger" | "board" | "workflow" | "log";

export interface TrailEvent {
	readonly at: number;
	readonly source: TrailSource;
	/** Short machine-comparable kind (`lane_change`, `attempt`, `sandbox_workspace_disposed`, …). */
	readonly kind: string;
	readonly detail: string;
	/** Anything the source carried that a reader might need. Kept verbatim — over-covering is the point. */
	readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TrailSourceStatus {
	readonly source: TrailSource;
	readonly available: boolean;
	readonly eventCount: number;
	/** Why a source contributed nothing — absent file, unreadable, or genuinely empty. These are NOT the same. */
	readonly note: string;
}

export interface CardTrail {
	readonly cardId: string;
	readonly events: readonly TrailEvent[];
	readonly sourcesRead: readonly TrailSourceStatus[];
	/** True when at least one source was unavailable — the trail may be incomplete and says so. */
	readonly partial: boolean;
	readonly summary: string;
}

/** Stable rank so events sharing a timestamp order deterministically. */
const SOURCE_RANK: Record<TrailSource, number> = {
	board: 0,
	workflow: 1,
	ledger: 2,
	observation: 3,
	log: 4,
};

/**
 * Merge per-source events into one ordered trail.
 *
 * `sourcesRead` is REQUIRED rather than derived from the events, because "this source produced no events" and
 * "this source could not be read" are different facts and only one of them means the trail is trustworthy. A
 * card that genuinely did nothing and a card whose log was deleted look identical without it.
 */
export function buildCardTrail(input: {
	readonly cardId: string;
	readonly events: readonly TrailEvent[];
	readonly sourcesRead: readonly TrailSourceStatus[];
}): CardTrail {
	const events = [...input.events]
		.map((event, index) => ({ event, index }))
		.sort((left, right) => {
			if (left.event.at !== right.event.at) {
				return left.event.at - right.event.at;
			}
			const rank = SOURCE_RANK[left.event.source] - SOURCE_RANK[right.event.source];
			return rank !== 0 ? rank : left.index - right.index;
		})
		.map((entry) => entry.event);

	const missing = input.sourcesRead.filter((status) => !status.available);
	const partial = missing.length > 0;

	return {
		cardId: input.cardId,
		events,
		sourcesRead: input.sourcesRead,
		partial,
		summary: [
			`${events.length} event(s) for ${input.cardId} across ${input.sourcesRead.filter((s) => s.available).length}/${input.sourcesRead.length} source(s).`,
			partial
				? `⚠️ PARTIAL — unavailable: ${missing.map((s) => `${s.source} (${s.note})`).join(", ")}. A missing source is not an absence of activity; do not read this trail as complete.`
				: "All sources readable.",
		].join(" "),
	};
}

/**
 * Render a trail for a human.
 *
 * Deliberately plain and chronological. A forensic view that groups or summarises hides the ADJACENCY that
 * usually carries the answer — on 2026-07-20 the decisive fact was that a bounce and a capture failure were six
 * lines apart, which no grouping would have preserved.
 */
export function renderCardTrail(trail: CardTrail): string {
	const lines = [`── TRAIL: ${trail.cardId} ──`, trail.summary, ""];
	for (const event of trail.events) {
		// A source with no clock (runtime.log) carries a synthetic ordinal, and an unparseable record can carry 0
		// or NaN. Rendering those through `toISOString` throws — a forensic tool must never die on the malformed
		// record it exists to show you.
		const stamp =
			Number.isFinite(event.at) && event.at > 0 && event.at < 8.64e15
				? new Date(event.at).toISOString().replace("T", " ").slice(0, 23)
				: "(no timestamp)          ";
		lines.push(`${stamp}  [${event.source}] ${event.kind}: ${event.detail}`);
		for (const [key, value] of Object.entries(event.metadata ?? {})) {
			if (value !== null && value !== undefined && value !== "") {
				lines.push(`${" ".repeat(25)}  ${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
			}
		}
	}
	if (trail.events.length === 0) {
		lines.push("(no events — check `sourcesRead` above before concluding nothing happened)");
	}
	return lines.join("\n");
}

/**
 * Find gaps a debugger should be suspicious of: long stretches with no recorded activity.
 *
 * A card that "did nothing for eleven minutes" is either idle or stalled, and the trail cannot tell you which —
 * but it CAN tell you where to look. Reported rather than judged, because an idle gap is normal on a dependency-
 * blocked card and pathological on a running one, and this module does not know which it was.
 */
export function findTrailGaps(
	trail: CardTrail,
	minGapMs = 60_000,
): readonly { readonly afterKind: string; readonly gapMs: number; readonly at: number }[] {
	const gaps: { afterKind: string; gapMs: number; at: number }[] = [];
	for (let index = 1; index < trail.events.length; index += 1) {
		const previous = trail.events[index - 1] as TrailEvent;
		const current = trail.events[index] as TrailEvent;
		const gapMs = current.at - previous.at;
		if (gapMs >= minGapMs) {
			gaps.push({ afterKind: previous.kind, gapMs, at: previous.at });
		}
	}
	return gaps.sort((left, right) => right.gapMs - left.gapMs);
}
