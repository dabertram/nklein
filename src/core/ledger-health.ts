/**
 * F12.35b — assess the agent ledger's health: fragmentation and reader/writer hash agreement. PURE core.
 *
 * The ledger is keyed by a hash of the workspace path, one file per hash. F12.35b found that key silently
 * fragments: a writer that hashed a different path than the reader (the sandbox-vs-host confusion) scatters
 * history across files no consumer ever opens, and `review_effort_scaling` recorded ZERO across 44,421
 * observations because its review runner read a hash that matched no file at all.
 *
 * That was a one-time manual investigation (compute the hash over every plausible path, diff against 76 files).
 * This makes it a repeatable check, because the same seam feeds F12.14 (scaffold), F12.81 (exemplars) and
 * F3.7b (behaviour profiles) — a fragmentation that returns nothing degrades all of them the same silent way.
 *
 * ── THE ONE FINDING THAT IS A DEFECT, NOT A CURIOSITY ──
 * `currentPathMatchesNoFile` is the smoking gun: a consumer running from a path whose hash names no ledger file
 * gets an EMPTY history and cannot tell that from "this task genuinely has no records." Everything else here is
 * context that helps explain it; that one boolean is the thing to act on.
 */

export interface LedgerFileStat {
	/** The 16-char workspace-path hash that is the filename stem. */
	readonly hash: string;
	readonly eventCount: number;
}

export interface LedgerHealthInput {
	readonly files: readonly LedgerFileStat[];
	/** The hash the CURRENT workspace path resolves to — what a consumer here would read. */
	readonly currentPathHash: string;
	/** The hash of the "unknown" sentinel (an empty/null workspace path bucket). */
	readonly unknownHash: string;
}

export interface LedgerHealth {
	readonly fileCount: number;
	readonly totalEvents: number;
	/** Files holding exactly one event — the fragmentation signature. */
	readonly singleEventFiles: number;
	/** True when some events were bucketed under the null/empty-path sentinel, unreachable by any real path. */
	readonly hasUnknownSentinel: boolean;
	/**
	 * ⚠️ The defect. True when the current workspace path's hash matches NO ledger file, so a consumer here reads
	 * an empty history it cannot distinguish from a genuinely-empty task.
	 */
	readonly currentPathMatchesNoFile: boolean;
	readonly summary: string;
}

export function assessLedgerHealth(input: LedgerHealthInput): LedgerHealth {
	const fileCount = input.files.length;
	const totalEvents = input.files.reduce((sum, file) => sum + Math.max(0, file.eventCount), 0);
	const singleEventFiles = input.files.filter((file) => file.eventCount === 1).length;
	const hasUnknownSentinel = input.files.some((file) => file.hash === input.unknownHash && file.eventCount > 0);
	const currentPathMatchesNoFile = !input.files.some((file) => file.hash === input.currentPathHash);

	const notes: string[] = [];
	if (currentPathMatchesNoFile) {
		notes.push(
			"⚠️ the CURRENT path's hash matches NO ledger file — a consumer here reads EMPTY history, indistinguishable from a task with no records (F12.35b's cause).",
		);
	}
	if (fileCount > 0 && singleEventFiles / fileCount >= 0.3) {
		notes.push(
			`${singleEventFiles}/${fileCount} files hold a single event — heavy fragmentation, consistent with writers hashing different paths for the same run.`,
		);
	}
	if (hasUnknownSentinel) {
		notes.push(
			'some events are bucketed under the "unknown" sentinel (null/empty workspace path) — unreachable by any path-derived read.',
		);
	}

	return {
		fileCount,
		totalEvents,
		singleEventFiles,
		hasUnknownSentinel,
		currentPathMatchesNoFile,
		summary:
			notes.length === 0
				? `${fileCount} ledger file(s), ${totalEvents} event(s); the current path resolves to a real file and fragmentation is low.`
				: `${fileCount} file(s), ${totalEvents} event(s). ${notes.join(" ")}`,
	};
}
