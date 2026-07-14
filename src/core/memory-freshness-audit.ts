/**
 * F5.2 (pure core) — Basic Memory FRESHNESS / CONSISTENCY audit. A cadence-gated, MODEL-FREE pass over the local
 * `basic-memory` knowledge base that flags structural hygiene issues (complementary to the model-driven TRUTH audit in
 * `memory-audit.ts`, which decides confirmed/contradicted/unverifiable):
 *  - `stale`           — not updated within the staleness window (knowledge that may have rotted)
 *  - `orphaned`        — no outgoing links AND nothing links to it (isolated from the graph, easy to lose)
 *  - `broken_link`     — an outgoing `[[link]]` whose target note does not exist (a consistency defect)
 *  - `duplicate_title` — the same normalized title on ≥2 notes (a likely conflict/fork)
 *
 * Pure + deterministic (clock injected). The effectful b-leaf reads real basic-memory notes into
 * {@link AuditableMemoryNote}, runs this on the cadence, and surfaces findings + the last/next-run controls; keeping the
 * cadence gate here ({@link shouldRunFreshnessAudit}) is what stops the idle rail from turning into polling churn.
 */

export interface AuditableMemoryNote {
	/** Stable identity — the permalink/id used as a `[[link]]` target. */
	readonly id: string;
	readonly title: string;
	/** Last-modified time (ms epoch). */
	readonly updatedAt: number;
	/** Outgoing `[[wikilink]]` targets (ids or titles), as authored. */
	readonly links: readonly string[];
}

export type MemoryFreshnessFindingKind = "stale" | "orphaned" | "broken_link" | "duplicate_title";

export interface MemoryFreshnessFinding {
	readonly kind: MemoryFreshnessFindingKind;
	readonly noteId: string;
	readonly noteTitle: string;
	/** Human-readable specifics (age, the dangling target, the shared title). */
	readonly detail: string;
}

export interface MemoryFreshnessAuditConfig {
	/** A note not updated within this window (ms) is flagged `stale`. */
	readonly stalenessThresholdMs: number;
	/** How often the audit should run (ms) — the cadence gate for the scheduler. */
	readonly cadenceMs: number;
}

export interface MemoryFreshnessAuditResult {
	readonly findings: readonly MemoryFreshnessFinding[];
	readonly auditedAt: number;
	readonly nextAuditAt: number;
	readonly notesAudited: number;
	/** Count per finding kind (all kinds present, 0 when none) — the operator summary. */
	readonly summary: Readonly<Record<MemoryFreshnessFindingKind, number>>;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Normalize a title/id for link resolution + duplicate detection (case-insensitive, trimmed, ws-collapsed). */
function normalizeKey(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function emptySummary(): Record<MemoryFreshnessFindingKind, number> {
	return { stale: 0, orphaned: 0, broken_link: 0, duplicate_title: 0 };
}

/**
 * Whether the audit is due: never-run (`lastAuditAt` null) OR at least one cadence has elapsed. Pure so the scheduler
 * gates on it without a clock of its own — the churn-avoidance guard F5.2 calls for.
 */
export function shouldRunFreshnessAudit(
	lastAuditAt: number | null,
	config: MemoryFreshnessAuditConfig,
	now: number,
): boolean {
	if (lastAuditAt === null) {
		return true;
	}
	return now - lastAuditAt >= Math.max(0, config.cadenceMs);
}

export function auditMemoryFreshness(
	notes: readonly AuditableMemoryNote[],
	config: MemoryFreshnessAuditConfig,
	now: number,
): MemoryFreshnessAuditResult {
	// Resolve link targets against BOTH id and title so an authored `[[Some Title]]` or `[[some-id]]` both count.
	const knownKeys = new Set<string>();
	const titleCounts = new Map<string, number>();
	const incomingLinkKeys = new Set<string>();
	for (const note of notes) {
		knownKeys.add(normalizeKey(note.id));
		knownKeys.add(normalizeKey(note.title));
		const titleKey = normalizeKey(note.title);
		titleCounts.set(titleKey, (titleCounts.get(titleKey) ?? 0) + 1);
	}
	for (const note of notes) {
		for (const link of note.links) {
			incomingLinkKeys.add(normalizeKey(link));
		}
	}

	const findings: MemoryFreshnessFinding[] = [];
	const summary = emptySummary();
	const push = (finding: MemoryFreshnessFinding): void => {
		findings.push(finding);
		summary[finding.kind] += 1;
	};
	const stalenessThresholdMs = Math.max(0, config.stalenessThresholdMs);

	for (const note of notes) {
		const idKey = normalizeKey(note.id);
		const titleKey = normalizeKey(note.title);

		const ageMs = now - note.updatedAt;
		if (ageMs > stalenessThresholdMs) {
			push({
				kind: "stale",
				noteId: note.id,
				noteTitle: note.title,
				detail: `not updated in ${Math.floor(ageMs / MS_PER_DAY)}d (threshold ${Math.floor(stalenessThresholdMs / MS_PER_DAY)}d)`,
			});
		}

		// Orphaned: no outgoing links AND nothing links to it (by id or title).
		const hasIncoming = incomingLinkKeys.has(idKey) || incomingLinkKeys.has(titleKey);
		if (note.links.length === 0 && !hasIncoming) {
			push({ kind: "orphaned", noteId: note.id, noteTitle: note.title, detail: "no incoming or outgoing links" });
		}

		// Broken links: an outgoing target that resolves to no known note.
		for (const link of note.links) {
			if (!knownKeys.has(normalizeKey(link))) {
				push({ kind: "broken_link", noteId: note.id, noteTitle: note.title, detail: `dangling link → "${link}"` });
			}
		}

		// Duplicate title: this title is shared by another note (report each participant once).
		if ((titleCounts.get(titleKey) ?? 0) > 1) {
			push({
				kind: "duplicate_title",
				noteId: note.id,
				noteTitle: note.title,
				detail: `title shared by ${titleCounts.get(titleKey)} notes`,
			});
		}
	}

	return {
		findings,
		auditedAt: now,
		nextAuditAt: now + Math.max(0, config.cadenceMs),
		notesAudited: notes.length,
		summary,
	};
}
