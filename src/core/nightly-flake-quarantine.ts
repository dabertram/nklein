/**
 * N13 — suite self-trust: double-run flake quarantine. A pre-release nightly runs each cell TWICE; any verdict
 * flip between the paired runs means the cell is not deterministic, and a suite that flakes gets ignored — which
 * is worse than no suite (the smoke arc's false-green lesson). A flipped cell is QUARANTINED: reported loudly on
 * every subsequent run and excluded from the pass/fail gate until a human root-causes it and deletes its entry
 * from the quarantine file. Quarantine is deliberately a REPO-VISIBLE data file, not runtime state: excluding a
 * cell from the gate is an engineering decision that must survive machines, show up in diffs, and be reviewable.
 *
 * Pure + total: no clock, no filesystem — timestamps and file contents are passed in.
 */

/** Mirrors the runner's cell outcomes. A deterministic skip repeats; a skip↔run flip is nondeterminism too. */
export type NightlyRunOutcome = "passed" | "failed" | "skipped";

export interface NightlyQuarantineEntry {
	cellId: string;
	/** ISO timestamp of the run that observed the flip (caller-supplied — this module has no clock). */
	quarantinedAt: string;
	firstOutcome: NightlyRunOutcome;
	secondOutcome: NightlyRunOutcome;
	firstReason: string | null;
	secondReason: string | null;
	/** The standing instruction to whoever clears the entry. */
	note: string;
}

export interface NightlyQuarantineFile {
	schemaVersion: 1;
	entries: NightlyQuarantineEntry[];
}

export const EMPTY_NIGHTLY_QUARANTINE: NightlyQuarantineFile = { schemaVersion: 1, entries: [] };

const QUARANTINE_NOTE =
	"Verdict flipped between paired double runs. Root-cause the nondeterminism (see N13 in todo.md), then delete this entry to restore the cell to the gate.";

/** Tolerant parse: null/blank/corrupt input yields the empty file (an unreadable quarantine must not crash the suite). */
export function parseNightlyQuarantineFile(raw: string | null | undefined): NightlyQuarantineFile {
	if (!raw?.trim()) {
		return EMPTY_NIGHTLY_QUARANTINE;
	}
	try {
		const parsed = JSON.parse(raw) as Partial<NightlyQuarantineFile>;
		if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
			return EMPTY_NIGHTLY_QUARANTINE;
		}
		const entries = parsed.entries.filter(
			(entry): entry is NightlyQuarantineEntry =>
				typeof entry === "object" &&
				entry !== null &&
				typeof (entry as { cellId?: unknown }).cellId === "string" &&
				(entry as { cellId: string }).cellId.length > 0,
		);
		return { schemaVersion: 1, entries };
	} catch {
		return EMPTY_NIGHTLY_QUARANTINE;
	}
}

export function serializeNightlyQuarantineFile(file: NightlyQuarantineFile): string {
	return `${JSON.stringify(file, null, "\t")}\n`;
}

export interface PairedCellRun {
	cellId: string;
	first: { outcome: NightlyRunOutcome; reason: string | null };
	second: { outcome: NightlyRunOutcome; reason: string | null };
}

/** The flips among paired runs — each becomes a quarantine entry stamped with the caller's timestamp. */
export function detectVerdictFlips(pairs: readonly PairedCellRun[], observedAtIso: string): NightlyQuarantineEntry[] {
	return pairs
		.filter((pair) => pair.first.outcome !== pair.second.outcome)
		.map((pair) => ({
			cellId: pair.cellId,
			quarantinedAt: observedAtIso,
			firstOutcome: pair.first.outcome,
			secondOutcome: pair.second.outcome,
			firstReason: pair.first.reason,
			secondReason: pair.second.reason,
			note: QUARANTINE_NOTE,
		}));
}

/** Merge newly-observed flips into the persisted file. An already-quarantined cell keeps its ORIGINAL entry. */
export function mergeNightlyQuarantine(
	existing: NightlyQuarantineFile,
	newEntries: readonly NightlyQuarantineEntry[],
): NightlyQuarantineFile {
	const byCell = new Map(existing.entries.map((entry) => [entry.cellId, entry]));
	for (const entry of newEntries) {
		if (!byCell.has(entry.cellId)) {
			byCell.set(entry.cellId, entry);
		}
	}
	return { schemaVersion: 1, entries: [...byCell.values()] };
}

export interface QuarantineGateSplit<T> {
	/** Verdicts that count toward the pass/fail gate. */
	gated: T[];
	/** Verdicts excluded because their cell is quarantined (still reported, never silently dropped). */
	quarantined: Array<{ verdict: T; entry: NightlyQuarantineEntry }>;
}

/** Split verdicts into gate-relevant and quarantined, by cell id. */
export function splitVerdictsByQuarantine<T>(
	verdicts: readonly T[],
	cellIdOf: (verdict: T) => string,
	quarantine: NightlyQuarantineFile,
): QuarantineGateSplit<T> {
	const byCell = new Map(quarantine.entries.map((entry) => [entry.cellId, entry]));
	const split: QuarantineGateSplit<T> = { gated: [], quarantined: [] };
	for (const verdict of verdicts) {
		const entry = byCell.get(cellIdOf(verdict));
		if (entry) {
			split.quarantined.push({ verdict, entry });
		} else {
			split.gated.push(verdict);
		}
	}
	return split;
}

/**
 * The LOUD report. Quarantine that whispers becomes permanent exclusion — every run repeats the full list, what
 * flipped, and the clearing contract, so the entries cannot fade into background noise.
 */
export function formatQuarantineReport(input: {
	file: NightlyQuarantineFile;
	newlyQuarantined: readonly NightlyQuarantineEntry[];
}): string {
	if (input.file.entries.length === 0) {
		return "";
	}
	const newIds = new Set(input.newlyQuarantined.map((entry) => entry.cellId));
	const lines = [
		`🔴 FLAKE QUARANTINE: ${input.file.entries.length} cell(s) are EXCLUDED FROM THE GATE until root-caused.`,
		"   A cell that flips verdicts between identical runs proves the suite is not deterministic there;",
		"   its pass AND its fail are both meaningless until the nondeterminism is found.",
	];
	for (const entry of input.file.entries) {
		const marker = newIds.has(entry.cellId) ? "NEW THIS RUN" : `since ${entry.quarantinedAt}`;
		lines.push(
			`   — ${entry.cellId} (${marker}): run1=${entry.firstOutcome}, run2=${entry.secondOutcome}` +
				`${entry.secondOutcome === "failed" && entry.secondReason ? ` (${entry.secondReason.slice(0, 160)})` : ""}` +
				`${entry.firstOutcome === "failed" && entry.firstReason ? ` (run1: ${entry.firstReason.slice(0, 160)})` : ""}`,
		);
	}
	lines.push(
		"   Clear an entry ONLY with the root cause in hand: delete it from nightly-quarantine.json in the same commit as the fix.",
	);
	return lines.join("\n");
}
