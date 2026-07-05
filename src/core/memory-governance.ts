/**
 * §5.M memory governance (pure core) — the rules that keep AUTHORED memory (basic-memory notes) trustworthy + scoped.
 * The §5.AR store already gives each note a NAMESPACE (`ws-<hash>` per-project, or `global`); this adds the governance
 * on top: scope ENFORCEMENT (a session reads only its allowed namespaces — replacing the owed "access-all" boolean),
 * importance WEIGHTING (recency × frequency × explicit importance), non-destructive contradiction-REPLACEMENT with
 * REVERSIBLE history (supersede + link, never destroy), and soft DELETION. Provenance tagging + the audit verdict live
 * in {@link ./basic-memory-provenance} + {@link ./memory-audit}. Pure + total + deterministic.
 */

import { ageDecay } from "./basic-memory-provenance.js";

// ── Namespaced scope + enforcement (§5.M / §5.AR — replaces the owed "access-all-loaded-projects" boolean) ──────────

export interface MemoryAccessRequest {
	/** The namespaces this session may read/write — its scope (e.g. its own `ws-<hash>` + `global` when enabled). */
	allowedNamespaces: readonly string[];
	/** The namespace of the note being accessed. */
	noteNamespace: string;
}

/**
 * Scope enforcement: a session may touch a note ONLY when the note's namespace is in its allowed set. This is the
 * namespaced replacement for a global "can access everything" boolean — a per-project session can't read another
 * project's memory unless `global` (or that project) is explicitly in its scope.
 */
export function isMemoryAccessAllowed(request: MemoryAccessRequest): boolean {
	return request.allowedNamespaces.includes(request.noteNamespace);
}

// ── Importance weighting (recency × frequency × importance) ─────────────────────────────────────────────────────────

export interface MemoryImportanceSignals {
	/** How old the note is, in days (recency). */
	ageDays: number;
	/** How many times the note has been recalled (frequency). */
	accessCount: number;
	/** An explicit importance in [0,1] (clamped); default 0.5 when unknown. */
	importance?: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * A memory-importance score in [0,1] combining three signals so none alone zeroes a note: explicit importance scaled by
 * a recency factor (age decay) and a saturating frequency factor. A fresh, often-recalled, explicitly-important note
 * scores highest; an old, never-recalled one lowest — the ranking a governance sweep uses to decide what to keep/prune.
 */
export function scoreMemoryImportance(
	signals: MemoryImportanceSignals,
	options: { recencyHalfLifeDays?: number; frequencySaturation?: number } = {},
): number {
	const importance = clamp01(signals.importance ?? 0.5);
	const recencyFactor = ageDecay(signals.ageDays, options.recencyHalfLifeDays); // (0,1]
	const saturation = options.frequencySaturation && options.frequencySaturation > 0 ? options.frequencySaturation : 3;
	const accesses = Math.max(0, signals.accessCount);
	const frequencyFactor = accesses / (accesses + saturation); // 0 at 0 accesses, → 1 as accesses grow
	// Each factor contributes but keeps a floor (0.5 + 0.5·factor) so a valuable-but-cold note is de-weighted, not lost.
	return clamp01(importance * (0.5 + 0.5 * recencyFactor) * (0.5 + 0.5 * frequencyFactor));
}

// ── Contradiction-replacement + reversible history ─────────────────────────────────────────────────────────────────

export interface MemoryRevision {
	/** The note being superseded (retained, not destroyed — history is reversible). */
	supersededRef: string;
	/** The note that replaces it. */
	replacementRef: string;
	/** Why it was superseded (e.g. an audit `contradicted` verdict, or a newer fact). */
	reason: string;
	/** Always true: the old note is kept + linked, so a supersede is reversible (un-supersede restores it). */
	reversible: true;
}

/**
 * Contradiction-replacement: record that `replacementRef` supersedes `supersededRef` WITHOUT deleting the old note —
 * the old note is retained + linked so the change is reversible (the §5.M "reversible history" governance rule). A
 * governance sweep applies this when the audit contradicts a note but a corrected one exists.
 */
export function supersedeMemory(supersededRef: string, replacementRef: string, reason: string): MemoryRevision {
	return { supersededRef, replacementRef, reason, reversible: true };
}

// ── Soft deletion (reversible) ─────────────────────────────────────────────────────────────────────────────────────

export interface MemoryDeletion {
	ref: string;
	deleted: true;
	reason: string;
	/** Always true: deletion is a soft flag (the markdown file is retained), so it can be undone. */
	reversible: true;
}

/** Soft-delete a note: mark it deleted (retained on disk so it's reversible) rather than destroying it. */
export function markMemoryDeleted(ref: string, reason: string): MemoryDeletion {
	return { ref, deleted: true, reason, reversible: true };
}
