import type { RuntimeNKleinTeamProgressEvent, RuntimeTaskSessionSummary } from "@runtime-contract";

/**
 * Accumulates an agent's per-turn activity into a watchable timeline ("watch the agent's hands").
 *
 * The runtime streams the *latest* hook activity on each session-summary update, but no accumulated history —
 * so a viewer can only ever see the current step. This pure accumulator turns that stream of latest-activity
 * snapshots (plus team-progress events) into a deduplicated, capped, chronological timeline the Watch panel
 * renders like a remote developer's action log. Pure and unit-tested; no React, no network.
 */

export interface AgentActivityEntry {
	id: string;
	at: number;
	kind: "tool" | "progress" | "status";
	text: string;
	toolName: string | null;
	source: string | null;
}

const DEFAULT_MAX_ENTRIES = 200;

function entryId(at: number, text: string, toolName: string | null): string {
	return `${at}:${toolName ?? ""}:${text}`;
}

/** Folds a session summary's latest hook activity into the timeline (deduped by id), newest last. */
export function accumulateSessionActivity(
	existing: readonly AgentActivityEntry[],
	summary: Pick<RuntimeTaskSessionSummary, "latestHookActivity" | "lastHookAt" | "updatedAt" | "state">,
	maxEntries: number = DEFAULT_MAX_ENTRIES,
): AgentActivityEntry[] {
	const activity = summary.latestHookActivity;
	if (!activity?.activityText) {
		return existing as AgentActivityEntry[];
	}
	const at = summary.lastHookAt ?? summary.updatedAt;
	const toolName = activity.toolName ?? null;
	const id = entryId(at, activity.activityText, toolName);
	if (existing.some((entry) => entry.id === id)) {
		return existing as AgentActivityEntry[];
	}
	const next: AgentActivityEntry = {
		id,
		at,
		kind: toolName ? "tool" : "status",
		text: activity.activityText,
		toolName,
		source: activity.source ?? null,
	};
	return [...existing, next].slice(-maxEntries);
}

/** Merges team-progress events into the timeline (deduped), useful for multi-agent runs. */
export function accumulateTeamProgress(
	existing: readonly AgentActivityEntry[],
	events: readonly RuntimeNKleinTeamProgressEvent[],
	maxEntries: number = DEFAULT_MAX_ENTRIES,
): AgentActivityEntry[] {
	let timeline = existing as AgentActivityEntry[];
	for (const event of events) {
		if (!event.message) {
			continue;
		}
		const id = entryId(event.createdAt, event.message, event.agentId ?? null);
		if (timeline.some((entry) => entry.id === id)) {
			continue;
		}
		timeline = [
			...timeline,
			{
				id,
				at: event.createdAt,
				kind: "progress",
				text: event.message,
				toolName: null,
				source: event.agentId ?? null,
			},
		];
	}
	return timeline.sort((a, b) => a.at - b.at).slice(-maxEntries);
}
