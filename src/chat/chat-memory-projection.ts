import type { MemoryRecord } from "../core/memory-layers";

/**
 * F2.9 (§5.M) — the SELECTED memory projection: one unified, provenance-carrying read model over every memory
 * source a chat turn can recall from, replacing the chat-memory store's solo act as "the" memory. Sources:
 *   - `session`     — the chat-memory JSONL store's recalled entries (deletable: the user authored/owns them);
 *   - `working` / `episodic` / `semantic` / `procedural` — the §5.M four-layer projection over live state, the
 *     §5.AF ledger, its distilled facts, and the skill registry (NOT deletable: evidence and capabilities are
 *     projections of immutable substrate — deleting the view would not delete the fact);
 *   - `basic_memory` — durable project/global Basic Memory notes (deletable via their permalink);
 *   - `focus_chain`  — the session's live plan checklist (not deletable here; it is edited as a plan, not
 *     forgotten as a memory).
 * Every record carries provenance (source + ref) and a TYPED delete control, so the UI can show "why was this
 * recalled" and offer exactly the deletions that are real. Ranking is salience-first with per-source floors —
 * one chatty source can never crowd the others out of a bounded band. Pure + total; the turn-context wiring
 * (feeding the §5.AD memory band) is the follow-up leaf.
 */

export type UnifiedMemorySource =
	| "session"
	| "working"
	| "episodic"
	| "semantic"
	| "procedural"
	| "basic_memory"
	| "focus_chain";

export type MemoryDeleteControl =
	| { kind: "chat_memory"; memoryId: string }
	| { kind: "basic_memory_note"; permalink: string }
	| { kind: "none"; reason: string };

export interface UnifiedMemoryRecord {
	source: UnifiedMemorySource;
	/** Stable citation/dedup key (source-prefixed). */
	id: string;
	text: string;
	/** Ranking weight in [0,1]. */
	salience: number;
	/** Human-readable "why recalled / where from". */
	provenance: string;
	deleteControl: MemoryDeleteControl;
}

export interface SessionMemoryInput {
	id: string;
	text: string;
	/** Recall score in [0,1] from the store's similarity ranking. */
	score: number;
	shared: boolean;
}

export interface BasicMemoryNoteInput {
	permalink: string;
	title: string;
	excerpt: string;
	/** Relevance in [0,1] as ranked by the caller's search. */
	score: number;
}

export interface FocusChainStepInput {
	step: string;
	status: "pending" | "in_progress" | "done";
}

export interface ProjectUnifiedMemoryInput {
	sessionMemories?: readonly SessionMemoryInput[];
	/** Records from the §5.M four-layer projection (working/episodic/semantic/procedural). */
	layerRecords?: readonly MemoryRecord[];
	basicMemoryNotes?: readonly BasicMemoryNoteInput[];
	focusChainSteps?: readonly FocusChainStepInput[];
}

const NOT_DELETABLE_PROJECTION: MemoryDeleteControl = {
	kind: "none",
	reason:
		"A projection of immutable evidence (ledger/skills/live state) — deleting the view would not delete the fact.",
};

const NOT_DELETABLE_PLAN: MemoryDeleteControl = {
	kind: "none",
	reason: "The focus chain is edited as a plan, not forgotten as a memory.",
};

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

/** Flatten every source into the unified shape (unranked, unbounded — {@link selectMemoryBand} bounds it). */
export function projectUnifiedMemory(input: ProjectUnifiedMemoryInput): UnifiedMemoryRecord[] {
	const records: UnifiedMemoryRecord[] = [];
	for (const memory of input.sessionMemories ?? []) {
		records.push({
			source: "session",
			id: `session:${memory.id}`,
			text: memory.text,
			salience: clamp01(memory.score),
			provenance: memory.shared ? "chat memory (shared across sessions)" : "chat memory (this session)",
			deleteControl: { kind: "chat_memory", memoryId: memory.id },
		});
	}
	for (const record of input.layerRecords ?? []) {
		records.push({
			source: record.layer,
			id: `layer:${record.id}`,
			text: record.text,
			salience: clamp01(record.salience),
			provenance: record.provenance,
			deleteControl: NOT_DELETABLE_PROJECTION,
		});
	}
	for (const note of input.basicMemoryNotes ?? []) {
		records.push({
			source: "basic_memory",
			id: `basic:${note.permalink}`,
			text: `${note.title}: ${note.excerpt}`.trim(),
			salience: clamp01(note.score),
			provenance: `Basic Memory note ${note.permalink}`,
			deleteControl: { kind: "basic_memory_note", permalink: note.permalink },
		});
	}
	const steps = input.focusChainSteps ?? [];
	const active = steps.find((step) => step.status === "in_progress");
	if (active) {
		records.push({
			source: "focus_chain",
			id: "focus:active",
			text: `Current plan step: ${active.step}`,
			salience: 1,
			provenance: "the session's live focus chain",
			deleteControl: NOT_DELETABLE_PLAN,
		});
	}
	return records;
}

export interface MemoryBandOptions {
	/** Total records in the band. Default 12. */
	maxRecords?: number;
	/** Guaranteed slots per source WITH candidates (before global ranking fills the rest). Default 1. */
	perSourceFloor?: number;
}

/**
 * Rank into a bounded band: every source with candidates gets its floor first (its best records), then the
 * remaining slots fill globally by salience — so a chatty source can never crowd out the others entirely, and
 * the best content still wins the free slots. Deterministic (salience desc, then id asc).
 */
export function selectMemoryBand(
	records: readonly UnifiedMemoryRecord[],
	options: MemoryBandOptions = {},
): UnifiedMemoryRecord[] {
	const maxRecords = Math.max(1, Math.trunc(options.maxRecords ?? 12));
	const perSourceFloor = Math.max(0, Math.trunc(options.perSourceFloor ?? 1));
	const sorted = [...records].sort((a, b) => b.salience - a.salience || a.id.localeCompare(b.id));

	const chosen: UnifiedMemoryRecord[] = [];
	const chosenIds = new Set<string>();
	if (perSourceFloor > 0) {
		const bySource = new Map<UnifiedMemorySource, UnifiedMemoryRecord[]>();
		for (const record of sorted) {
			const bucket = bySource.get(record.source) ?? [];
			bucket.push(record);
			bySource.set(record.source, bucket);
		}
		for (const [, bucket] of [...bySource.entries()].sort(([a], [b]) => a.localeCompare(b))) {
			for (const record of bucket.slice(0, perSourceFloor)) {
				if (chosen.length >= maxRecords) {
					break;
				}
				chosen.push(record);
				chosenIds.add(record.id);
			}
		}
	}
	for (const record of sorted) {
		if (chosen.length >= maxRecords) {
			break;
		}
		if (!chosenIds.has(record.id)) {
			chosen.push(record);
			chosenIds.add(record.id);
		}
	}
	return chosen.sort((a, b) => b.salience - a.salience || a.id.localeCompare(b.id));
}

/**
 * F2.9b — render a memory band into the leading system note the turn is fed (the flag-gated unified-recall feed). Each
 * line carries its source so a small model can weight it ("why recalled / where from"). Returns null for an empty band
 * so the caller adds nothing (byte-identical to no note). Pure.
 */
export function buildUnifiedMemoryNote(records: readonly UnifiedMemoryRecord[]): string | null {
	if (records.length === 0) {
		return null;
	}
	const lines = records.map((record) => `- (${record.source}) ${record.text}`);
	return `Relevant memory recalled for this turn (each line tagged with its source — weight it accordingly):\n${lines.join("\n")}`;
}
