/**
 * F12.19 read-before-write + stale-read guard — PURE core.
 *
 * Two classic small-model write hazards: writing a file it NEVER READ (search-replace against imagined content),
 * and writing from a READ that is now STALE (the file changed since — another card's merge, its own earlier edit
 * through a different tool). This tracker records per-session read/write observations and answers, at write time,
 * whether the write is grounded. Verdicts are ADVISORY tiers for the tool boundary: an ungrounded full-file write
 * may be legitimate (new file), so callers warn/annotate rather than hard-block; a stale read is the loud one.
 * Pure + deterministic: the caller supplies mtimes/clock; state is an explicit value the caller owns.
 */

export interface FileReadRecord {
	/** The file's mtime (ms) AT read time, when the caller knows it; null = unknown (guard degrades gracefully). */
	readonly mtimeAtRead: number | null;
	readonly readAt: number;
}

export type ReadBeforeWriteState = Map<string, FileReadRecord>;

export function createReadBeforeWriteState(): ReadBeforeWriteState {
	return new Map();
}

/** Record that the session read a file (any read/search tool that returned its content). */
export function recordFileRead(
	state: ReadBeforeWriteState,
	path: string,
	input: { mtime: number | null; now: number },
): void {
	state.set(path, { mtimeAtRead: input.mtime, readAt: input.now });
}

export type WriteGroundingVerdict =
	| { readonly kind: "grounded"; readonly detail: string }
	| { readonly kind: "never_read"; readonly detail: string }
	| { readonly kind: "stale_read"; readonly detail: string };

/**
 * Judge a write against the session's read history. `currentMtime` is the file's mtime NOW (null = file absent —
 * a new-file write is trivially grounded; unknown mtimes make staleness undetectable, so the read wins the tie).
 */
export function assessWriteGrounding(
	state: ReadBeforeWriteState,
	path: string,
	input: { currentMtime: number | null },
): WriteGroundingVerdict {
	if (input.currentMtime === null) {
		return { kind: "grounded", detail: "New file — nothing to have read first." };
	}
	const read = state.get(path);
	if (!read) {
		return {
			kind: "never_read",
			detail: "Writing a file this session NEVER READ — edits may target imagined content. Read it first.",
		};
	}
	if (read.mtimeAtRead !== null && input.currentMtime > read.mtimeAtRead) {
		return {
			kind: "stale_read",
			detail: `The file changed after it was last read (mtime ${input.currentMtime} > ${read.mtimeAtRead}) — re-read before editing or the write may clobber newer content.`,
		};
	}
	return { kind: "grounded", detail: "Write follows a current read." };
}

/** A successful write refreshes the record — the session now "knows" the post-write content. */
export function recordFileWrite(
	state: ReadBeforeWriteState,
	path: string,
	input: { mtimeAfterWrite: number | null; now: number },
): void {
	state.set(path, { mtimeAtRead: input.mtimeAfterWrite, readAt: input.now });
}
