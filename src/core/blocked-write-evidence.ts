/**
 * P1.PASSEDBUTUNLANDED — what the runtime ALREADY KNEW and never told the reviewer. PURE core.
 *
 * ── THE INCIDENT (project 47, `record-returns-agent-requirements`, requests 1842-1846, 2026-09-10) ──
 * A worker emitted two tool calls in one turn: `edit_file` on `spec/requirements.json`, and `run_commands: npm
 * test`. The edit was REJECTED ("edit block 1 did not match … closest match was 40% similar"). The test then ran
 * in the same turn and passed 4/4 — VACUOUSLY, because the file was untouched and the entries a previous card had
 * added are well-formed. The model read a green acceptance and reported completion ("npm test is 4/4 green
 * post-edit, confirming both new entries are correctly formed"); neither entry existed. Capture was `empty`, no
 * result branch, nothing on the trunk.
 *
 * The review caught it — "No file changes" → `request_changes` — so the fail-safe held and the cost was one round
 * trip. But the reviewer had to INFER from an absent diff what the tool log already stated in plain text: the
 * write was blocked. This module turns that record into evidence the seed prompt can carry.
 *
 * ── EVIDENCE, NOT A GATE ──
 * The note never decides anything. A blocked write is not proof the card is a no-op (the worker may have retried
 * successfully, or written through another tool), and an empty capture is not proof of a blocked write. Both facts
 * are shown to the reviewer, who already owns the verdict — the same shape as the other review directives.
 * Pure + total: no clock, no I/O; malformed input yields no note.
 */

/** The tools that PUT BYTES ON DISK. A failed `read_files` says nothing about whether the card landed its work. */
const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(["write_file", "write_files", "edit_file", "editor"]);

/** How much of a rejection message to quote — enough to name the reason, not enough to crowd the seed. */
const REASON_BUDGET = 240;
/** Cap the listed calls: a worker that looped on a bad anchor produces many identical rejections. */
const MAX_LISTED = 5;

/** One tool call as the transcript extractor records it (`extractTerminalToolCalls`). */
export interface BlockedWriteToolCall {
	readonly name: string;
	/** The recorded outcome, as the ledger types it (a widened string): only the literal `"error"` counts here. */
	readonly outcome?: string | null;
	readonly filePaths?: readonly string[];
	/** The bounded preview of what the tool returned — the rejection text, when it was rejected. */
	readonly resultSummary?: string | null;
}

export interface BlockedWriteEvidence {
	/** How many write calls came back as errors. */
	readonly blockedCount: number;
	/** The distinct paths those calls were aimed at, in first-seen order. */
	readonly paths: readonly string[];
	/** Prompt-ready markdown, already self-labelled — the caller appends it verbatim. */
	readonly note: string;
}

function normalizePath(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The blocked writes in one session's tool calls, or null when there were none.
 *
 * A call counts when it named a write tool AND its result came back an error. `outcome` is set from the tool
 * result, so a call still in flight (`null`) is not counted — an unfinished write is not a refused one.
 */
export function summarizeBlockedWrites(
	calls: readonly BlockedWriteToolCall[] | null | undefined,
): BlockedWriteEvidence | null {
	if (!Array.isArray(calls) || calls.length === 0) {
		return null;
	}
	const blocked = calls.filter(
		(call) => typeof call?.name === "string" && WRITE_TOOL_NAMES.has(call.name.trim()) && call.outcome === "error",
	);
	if (blocked.length === 0) {
		return null;
	}
	const paths: string[] = [];
	for (const call of blocked) {
		for (const raw of call.filePaths ?? []) {
			const path = normalizePath(raw);
			if (path && !paths.includes(path)) {
				paths.push(path);
			}
		}
	}
	const listed = blocked.slice(0, MAX_LISTED).map((call) => {
		const where = (call.filePaths ?? []).map(normalizePath).filter(Boolean).join(", ");
		const reason = (call.resultSummary ?? "").trim().replace(/\s+/gu, " ").slice(0, REASON_BUDGET);
		return `- \`${call.name}\`${where ? ` on ${where}` : ""}${reason ? ` — rejected: ${reason}` : " — rejected"}`;
	});
	const more = blocked.length - listed.length;
	const note = [
		"## The runtime blocked this card's write(s)",
		`${blocked.length} write tool call(s) in this session came back REJECTED, so bytes the worker believed it had` +
			" written were never written. This is recorded fact from the tool log, not an inference from the diff:",
		...listed,
		...(more > 0 ? [`- … and ${more} more rejected write call(s).`] : []),
		"An acceptance check that ran AFTER a rejected write can pass vacuously — it tested the file as it already" +
			" was. Judge whether the card's claimed work actually exists before approving.",
	].join("\n");
	return { blockedCount: blocked.length, paths, note };
}
