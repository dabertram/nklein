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
