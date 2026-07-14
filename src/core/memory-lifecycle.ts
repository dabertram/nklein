/**
 * Memory knowledge lifecycle (pure) — ported from opencode-swarm's knowledge lifecycle (utility scoring + auto-promote /
 * dedup / retire) and adapted to extend !Klein's F5.2 freshness audit. Where {@link auditMemoryFreshness} FLAGS hygiene
 * issues, this scores each note's UTILITY and turns the scores + the graph into PROPOSE-ONLY lifecycle recommendations:
 *
 *   - `promote` — a durable, well-connected, frequently-retrieved note worth promoting to the global/evergreen tier.
 *   - `retire`  — a stale, orphaned, never-retrieved note that is only adding noise (propose archiving, never delete).
 *   - `merge`   — a duplicate-title participant that likely forked and should be reconciled.
 *   - `keep`    — everything else.
 *
 * Propose-only by design: David's F5.2 choice is a READ-ONLY audit, so this never mutates the store — the effectful
 * b-leaf surfaces the recommendations for a human to act on (consistent with the rail-findings propose-only pattern).
 * Retrieval counts are OPTIONAL: absent ⇒ 0, so the score degrades gracefully to recency+centrality when there is no
 * retrieval telemetry yet.
 */

import type { AuditableMemoryNote } from "./memory-freshness-audit.js";

export type LifecycleAction = "promote" | "retire" | "merge" | "keep";

export interface NoteLifecycleSignals {
	/** How many times this note was retrieved (from telemetry); absent ⇒ 0. */
	readonly retrievalCount?: number;
}

export interface MemoryLifecycleConfig {
	/** A note older than this (ms) counts as aged for retire/recency scoring. */
	readonly stalenessThresholdMs: number;
	/** Retrievals at/above which a note is "evergreen" enough to propose promoting. */
	readonly evergreenMinRetrievals: number;
	/** Utility at/above which (with the retrieval floor) a note is a promote candidate. */
	readonly promoteUtilityThreshold: number;
	/** Utility at/below which (when also stale + orphaned + rarely retrieved) a note is a retire candidate. */
	readonly retireUtilityThreshold: number;
	/** Retrievals at/below which a note may be retired (a frequently-used note is never retired). */
	readonly retireMaxRetrievals: number;
}

export const DEFAULT_MEMORY_LIFECYCLE_CONFIG: MemoryLifecycleConfig = {
	stalenessThresholdMs: 90 * 24 * 60 * 60 * 1000,
	evergreenMinRetrievals: 3,
	promoteUtilityThreshold: 0.6,
	retireUtilityThreshold: 0.25,
	retireMaxRetrievals: 0,
};

export interface NoteLifecycleRecommendation {
	readonly noteId: string;
	readonly noteTitle: string;
	readonly action: LifecycleAction;
	/** 0..1 composite utility (recency + graph centrality + retrieval). */
	readonly utility: number;
	readonly rationale: string;
}

function normalizeKey(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

/**
 * 0..1 composite utility: 40% recency (age vs 2× the staleness window), 30% graph centrality (in+out links, saturating
 * at 4), 30% retrieval frequency (saturating at 2× the evergreen floor). Pure + deterministic.
 */
export function scoreNoteUtility(input: {
	note: AuditableMemoryNote;
	incomingLinkCount: number;
	retrievalCount: number;
	config: MemoryLifecycleConfig;
	now: number;
}): number {
	const ageMs = Math.max(0, input.now - input.note.updatedAt);
	const recency = clamp01(1 - ageMs / (2 * Math.max(1, input.config.stalenessThresholdMs)));
	const centrality = clamp01((input.note.links.length + input.incomingLinkCount) / 4);
	const retrievalNorm = Math.max(1, input.config.evergreenMinRetrievals * 2);
	const retrieval = clamp01(input.retrievalCount / retrievalNorm);
	return clamp01(0.4 * recency + 0.3 * centrality + 0.3 * retrieval);
}

export function classifyMemoryLifecycle(
	notes: readonly AuditableMemoryNote[],
	signalsById: Readonly<Record<string, NoteLifecycleSignals>>,
	config: MemoryLifecycleConfig = DEFAULT_MEMORY_LIFECYCLE_CONFIG,
	now: number = 0,
): NoteLifecycleRecommendation[] {
	// Resolve incoming links + duplicate titles the same way the F5.2 audit does (id OR title).
	const incomingLinkKeys = new Map<string, number>();
	const titleCounts = new Map<string, number>();
	for (const note of notes) {
		titleCounts.set(normalizeKey(note.title), (titleCounts.get(normalizeKey(note.title)) ?? 0) + 1);
		for (const link of note.links) {
			const key = normalizeKey(link);
			incomingLinkKeys.set(key, (incomingLinkKeys.get(key) ?? 0) + 1);
		}
	}

	const recommendations: NoteLifecycleRecommendation[] = [];
	for (const note of notes) {
		const idKey = normalizeKey(note.id);
		const titleKey = normalizeKey(note.title);
		const incomingLinkCount = (incomingLinkKeys.get(idKey) ?? 0) + (incomingLinkKeys.get(titleKey) ?? 0);
		const retrievalCount = Math.max(0, signalsById[note.id]?.retrievalCount ?? 0);
		const utility = scoreNoteUtility({ note, incomingLinkCount, retrievalCount, config, now });

		const isStale = now - note.updatedAt > config.stalenessThresholdMs;
		const isOrphaned = note.links.length === 0 && incomingLinkCount === 0;
		const isDuplicate = (titleCounts.get(titleKey) ?? 0) > 1;

		let action: LifecycleAction = "keep";
		let rationale = `utility ${utility.toFixed(2)}`;

		// Precedence: merge (a fork needs reconciling before promote/retire) → promote → retire → keep.
		if (isDuplicate) {
			action = "merge";
			rationale = `title shared by ${titleCounts.get(titleKey)} notes — reconcile the fork`;
		} else if (utility >= config.promoteUtilityThreshold && retrievalCount >= config.evergreenMinRetrievals) {
			action = "promote";
			rationale = `utility ${utility.toFixed(2)} + ${retrievalCount} retrievals — durable, promote to evergreen`;
		} else if (
			utility <= config.retireUtilityThreshold &&
			isStale &&
			isOrphaned &&
			retrievalCount <= config.retireMaxRetrievals
		) {
			action = "retire";
			rationale = `utility ${utility.toFixed(2)}, stale + orphaned + ${retrievalCount} retrievals — propose archiving`;
		}

		recommendations.push({ noteId: note.id, noteTitle: note.title, action, utility, rationale });
	}
	return recommendations;
}
