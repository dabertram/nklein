/**
 * Phase 7S / S11 — pure read-side summary of injection pre-screen events (from the injection-event store). Aggregates
 * per ingestion SURFACE: how many blocked vs flagged, the distinct sources, and the most common worst-finding — so a
 * `dev security-events` read (and later an operator alert) shows at a glance whether there's an active injection campaign
 * against the agents and where it's coming in. PURE + deterministic; no I/O.
 */

import type { StoredInjectionEvent } from "../state/injection-event-store.js";

export interface InjectionSurfaceSummary {
	readonly surface: string;
	readonly total: number;
	readonly blocked: number;
	readonly suspicious: number;
	/** Count of distinct sources that tripped the screen on this surface. */
	readonly distinctSources: number;
	/** The most frequent worst-finding code on this surface (ties broken alphabetically), or null when none. */
	readonly topFinding: string | null;
}

/** Summarize injection events per surface, worst-first (most blocked, then most total). */
export function summarizeInjectionEvents(events: readonly StoredInjectionEvent[]): InjectionSurfaceSummary[] {
	const bySurface = new Map<
		string,
		{ blocked: number; suspicious: number; sources: Set<string>; findings: Map<string, number> }
	>();
	for (const event of events) {
		const bucket = bySurface.get(event.surface) ?? {
			blocked: 0,
			suspicious: 0,
			sources: new Set<string>(),
			findings: new Map<string, number>(),
		};
		if (event.verdict === "block") {
			bucket.blocked += 1;
		} else {
			bucket.suspicious += 1;
		}
		bucket.sources.add(event.source);
		bucket.findings.set(event.worstFinding, (bucket.findings.get(event.worstFinding) ?? 0) + 1);
		bySurface.set(event.surface, bucket);
	}
	const summaries: InjectionSurfaceSummary[] = [];
	for (const [surface, bucket] of bySurface) {
		let topFinding: string | null = null;
		let topCount = 0;
		for (const [finding, count] of [...bucket.findings].sort((a, b) => a[0].localeCompare(b[0]))) {
			if (count > topCount) {
				topCount = count;
				topFinding = finding;
			}
		}
		summaries.push({
			surface,
			total: bucket.blocked + bucket.suspicious,
			blocked: bucket.blocked,
			suspicious: bucket.suspicious,
			distinctSources: bucket.sources.size,
			topFinding,
		});
	}
	return summaries.sort((a, b) => b.blocked - a.blocked || b.total - a.total || a.surface.localeCompare(b.surface));
}

/** Options for {@link detectInjectionSpike}. `now` is injected so the detector stays pure/deterministic (no clock read). */
export interface InjectionSpikeOptions {
	/** Current epoch-ms, injected by the caller (the CLI passes `Date.now()`); the recency window is measured back from here. */
	readonly now: number;
	/** How far back to count "recent" blocked events. Default 1 hour. */
	readonly windowMs?: number;
	/** Recent blocked-event count that trips the alert on its own. Default 3. */
	readonly blockThreshold?: number;
	/** Recent distinct-source count that trips a "coordinated campaign" alert even below the block count. Default 3. */
	readonly distinctSourceThreshold?: number;
}

/** Per-surface recent blocked-event count, worst-first. */
export interface InjectionSpikeSurface {
	readonly surface: string;
	readonly recentBlocks: number;
}

/** The result of {@link detectInjectionSpike} — whether an active injection campaign is visible in the recent window. */
export interface InjectionSpikeAlert {
	readonly triggered: boolean;
	readonly windowMs: number;
	/** Blocked events with `at` within the window. */
	readonly recentBlocks: number;
	/** Distinct sources among those recent blocked events (many distinct sources ⇒ coordinated). */
	readonly recentDistinctSources: number;
	readonly bySurface: readonly InjectionSpikeSurface[];
	/** One human sentence for the operator: what tripped it, or why it's quiet. */
	readonly reason: string;
}

const DEFAULT_SPIKE_WINDOW_MS = 60 * 60 * 1_000;
const DEFAULT_BLOCK_THRESHOLD = 3;
const DEFAULT_DISTINCT_SOURCE_THRESHOLD = 3;

/**
 * S11 alerting: detect a recent spike of BLOCKED injection attempts — a signal that a live campaign is being run against
 * the agents. Pure + deterministic (the current time is injected). An alert trips when either the recent blocked-event
 * count reaches `blockThreshold` (sustained volume) OR the recent distinct-source count reaches `distinctSourceThreshold`
 * (a coordinated fan-out from many origins, even at lower volume). Only `block`-verdict events count — `suspicious`
 * flags are noise-tolerant and would false-alarm. Events with no/zero `at` are treated as outside the window.
 */
export function detectInjectionSpike(
	events: readonly StoredInjectionEvent[],
	options: InjectionSpikeOptions,
): InjectionSpikeAlert {
	const windowMs = options.windowMs ?? DEFAULT_SPIKE_WINDOW_MS;
	const blockThreshold = options.blockThreshold ?? DEFAULT_BLOCK_THRESHOLD;
	const distinctSourceThreshold = options.distinctSourceThreshold ?? DEFAULT_DISTINCT_SOURCE_THRESHOLD;
	const cutoff = options.now - windowMs;

	const recentBlocks = events.filter((event) => event.verdict === "block" && event.at > cutoff);
	const sources = new Set<string>();
	const bySurfaceCount = new Map<string, number>();
	for (const event of recentBlocks) {
		sources.add(event.source);
		bySurfaceCount.set(event.surface, (bySurfaceCount.get(event.surface) ?? 0) + 1);
	}
	const bySurface: InjectionSpikeSurface[] = [...bySurfaceCount]
		.map(([surface, recent]) => ({ surface, recentBlocks: recent }))
		.sort((a, b) => b.recentBlocks - a.recentBlocks || a.surface.localeCompare(b.surface));

	const byVolume = recentBlocks.length >= blockThreshold;
	const byCoordination = sources.size >= distinctSourceThreshold;
	const triggered = byVolume || byCoordination;
	const windowLabel = `${Math.round(windowMs / 60_000)}m`;
	const reason = triggered
		? `${recentBlocks.length} blocked injection attempt(s) from ${sources.size} source(s) in the last ${windowLabel}` +
			`${byCoordination && !byVolume ? " (coordinated: many distinct sources)" : ""} — possible active campaign.`
		: `${recentBlocks.length} blocked injection attempt(s) in the last ${windowLabel} — below alert thresholds.`;

	return {
		triggered,
		windowMs,
		recentBlocks: recentBlocks.length,
		recentDistinctSources: sources.size,
		bySurface,
		reason,
	};
}
