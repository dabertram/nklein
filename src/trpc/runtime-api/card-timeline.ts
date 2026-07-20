import { homedir } from "node:os";
import type { RuntimeCardTimelineRequest, RuntimeCardTimelineResponse } from "../../core/task-lifecycle-api-contract";
import { gatherCardTrail } from "../../state/card-trail-sources";

/**
 * N18 — the forensic card timeline as a product endpoint.
 *
 * David, 2026-07-20: *"i want that timeline to be inherent part of !Klein and not just a debug tool."* This is
 * the seam that makes that true: the same gatherer the CLI uses, exposed to the UI, so the two cannot drift into
 * disagreeing about what happened to a card.
 *
 * ── THE TAIL CAP IS HONEST, NOT SILENT ──
 * `totalEvents` is the count BEFORE truncation. A timeline that quietly shows the newest N looks identical to a
 * complete one, and a reader who cannot see that events were dropped will conclude the earlier ones did not
 * happen — the same silence-reads-as-fine failure this whole epic exists to close.
 */
export async function handleGetCardTimeline(input: RuntimeCardTimelineRequest): Promise<RuntimeCardTimelineResponse> {
	// The live product reads the CURRENT user's home. The CLI takes an explicit `--home` because it is usually
	// pointed at a nightly cell's retained HOME, which is a different question.
	const trail = await gatherCardTrail({ home: homedir(), cardId: input.taskId });

	const limit = input.limit ?? 500;
	const totalEvents = trail.events.length;
	// Newest tail: the end of the story is what a person opening this panel is looking at.
	const events = totalEvents > limit ? trail.events.slice(totalEvents - limit) : trail.events;

	return {
		cardId: trail.cardId,
		events: events.map((event) => ({
			at: event.at,
			source: event.source,
			kind: event.kind,
			detail: event.detail,
			...(event.metadata ? { metadata: event.metadata } : {}),
		})),
		sourcesRead: trail.sourcesRead.map((status) => ({
			source: status.source,
			available: status.available,
			eventCount: status.eventCount,
			note: status.note,
		})),
		partial: trail.partial,
		summary: trail.summary,
		totalEvents,
	};
}
