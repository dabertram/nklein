/**
 * F12.20b — the INTENT-MERGE rung: the last step of the edit-application ladder, taken only when the
 * deterministic ladder (exact → elided-middle → Levenshtein fuzzy) has genuinely exhausted. PURE core.
 *
 * Byte-exact `old_str` reproduction is the #1 small-model edit failure, and the wins are in the APPLICATION
 * layer, not the diff format. When the fuzzy ladder cannot place a block, the remaining option is to stop asking
 * the model to reproduce anchor text and instead ask it to MERGE the intent: "here is the file, here is the edit
 * I wanted, produce the merged file".
 *
 * ── WHY THIS RUNG IS DANGEROUS, AND WHAT THE CORE DOES ABOUT IT ──
 * Every earlier rung applies a BOUNDED edit: it either places the block or it does not. This rung asks a model to
 * re-emit a WHOLE FILE, so its blast radius is the entire file. A model that helpfully "cleans up" while merging,
 * drops a function it considered dead, or silently reformats, produces a plausible file that passes review by
 * looking fine. **A failed edit is recoverable; a silent unrelated rewrite is not.** So this module:
 *
 *  1. REFUSES to escalate when the evidence says escalation is built on a bad premise (see `decideIntentMerge` —
 *     a very low best-similarity means the search block was probably hallucinated, and merging an edit derived
 *     from a hallucinated anchor would launder that error into a whole-file rewrite);
 *  2. bounds the file size, because "re-emit this file" degrades with length exactly where small models are
 *     weakest; and
 *  3. provides {@link assessIntentMergeSafety}, which the caller MUST run before accepting the merged content —
 *     it measures how much of the file changed beyond the intended edit and rejects an over-broad rewrite.
 *
 * The core never applies anything itself; it decides, prompts, parses, and judges.
 */

/** Above this size, "re-emit the whole file" is not a reasonable ask of the models this harness targets. */
export const MAX_INTENT_MERGE_CHARS = 24_000;
/**
 * Below this best-similarity the search block probably never existed in the file. Escalating here would merge an
 * edit whose premise is already wrong, so the honest move is to send the model back to READ the file.
 */
export const MIN_PREMISE_SIMILARITY = 0.35;

export interface IntentMergeDecisionInput {
	/** Did the deterministic ladder exhaust? Only an exhausted ladder may escalate. */
	readonly ladderExhausted: boolean;
	/** Best similarity the fuzzy pass achieved, when it reported one. */
	readonly bestSimilarity?: number | null;
	/** Size of the file that would be re-emitted. */
	readonly fileChars: number;
	/** How many intent-merge attempts this card already spent — the rung is once, not a loop. */
	readonly priorAttempts?: number;
}

export type IntentMergeDecisionKind = "escalate" | "reread" | "decline";

export interface IntentMergeDecision {
	readonly kind: IntentMergeDecisionKind;
	readonly reason: string;
}

/**
 * Decide whether the intent-merge rung is warranted. Deliberately conservative: `reread` (send the model back to
 * look at the file) is preferred over a merge whose premise is doubtful, because re-reading is cheap and a bad
 * merge is expensive and quiet.
 */
export function decideIntentMerge(input: IntentMergeDecisionInput): IntentMergeDecision {
	if (!input.ladderExhausted) {
		return { kind: "decline", reason: "the deterministic ladder has not exhausted — cheaper rungs remain" };
	}
	if ((input.priorAttempts ?? 0) > 0) {
		return {
			kind: "decline",
			reason: "an intent merge was already attempted for this edit — the rung is a last step, not a retry loop",
		};
	}
	const similarity = input.bestSimilarity ?? null;
	if (similarity !== null && similarity < MIN_PREMISE_SIMILARITY) {
		return {
			kind: "reread",
			reason: `best similarity ${similarity.toFixed(2)} is below ${MIN_PREMISE_SIMILARITY} — the search block probably never existed in this file, so merging would launder a hallucinated anchor into a whole-file rewrite; re-read the file instead`,
		};
	}
	if (!Number.isFinite(input.fileChars) || input.fileChars <= 0) {
		return { kind: "decline", reason: "file size unknown — cannot bound a whole-file re-emit" };
	}
	if (input.fileChars > MAX_INTENT_MERGE_CHARS) {
		return {
			kind: "decline",
			reason: `file is ${input.fileChars} chars, above the ${MAX_INTENT_MERGE_CHARS} intent-merge ceiling — whole-file re-emission degrades with length exactly where small models are weakest`,
		};
	}
	return {
		kind: "escalate",
		reason: `ladder exhausted${similarity !== null ? ` at best similarity ${similarity.toFixed(2)}` : ""} on a ${input.fileChars}-char file — intent merge is the remaining rung`,
	};
}

export interface IntentMergePromptInput {
	readonly filePath: string;
	readonly currentContent: string;
	/** The anchor the model tried and failed to place. */
	readonly attemptedSearch: string;
	/** What it wanted the anchor to become. */
	readonly attemptedReplace: string;
}

/**
 * Build the intent-merge prompt. It states the failure honestly (the anchor did not match), asks for the MERGED
 * FILE ONLY, and — the load-bearing instruction — forbids any change beyond the intended edit, because the
 * failure mode this rung introduces is a helpful unrelated rewrite rather than a wrong edit.
 */
export function buildIntentMergePrompt(input: IntentMergePromptInput): string {
	return [
		`Your edit to \`${input.filePath}\` could not be applied: the search text did not match the file.`,
		"Stop trying to reproduce the anchor. Instead, apply the INTENT of the edit to the file directly.",
		"",
		"## The edit you intended",
		"You wanted to replace this:",
		"```",
		input.attemptedSearch.trim(),
		"```",
		"with this:",
		"```",
		input.attemptedReplace.trim(),
		"```",
		"",
		"## The file as it actually is",
		"```",
		input.currentContent,
		"```",
		"",
		"## What to return",
		"Return the COMPLETE merged file inside a single fenced code block, and nothing else.",
		"",
		"**Change ONLY what the intended edit requires.** Do not reformat, do not rename anything you were not",
		"asked to rename, do not remove code you believe is unused, and do not 'improve' anything nearby. Every",
		"line you alter beyond the intended edit will be treated as an error and the merge will be rejected.",
		"If the intended edit does not make sense against this file, return the file UNCHANGED and say why in one",
		"line after the code block.",
	].join("\n");
}

/**
 * Extract the merged file from the model's reply — the first fenced block, or null when the reply has none.
 * Returning null (rather than guessing at unfenced prose) is deliberate: an unparseable reply must not become a
 * file write.
 */
export function parseIntentMergeReply(text: string): string | null {
	const fence = text.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/);
	const body = fence?.[1];
	if (body === undefined) {
		return null;
	}
	const trimmed = body.replace(/\s+$/, "");
	return trimmed.length > 0 ? trimmed : null;
}

export interface IntentMergeSafetyInput {
	readonly original: string;
	readonly merged: string;
	/** The replacement the edit intended, used to size the change that was actually asked for. */
	readonly attemptedReplace: string;
	/**
	 * How many lines beyond the intended edit may change before the merge is rejected. Small by design — the
	 * point of the check is to catch a helpful rewrite, and a legitimate merge touches roughly the edit's size.
	 */
	readonly slackLines?: number;
}

export interface IntentMergeSafety {
	readonly accepted: boolean;
	readonly changedLines: number;
	readonly allowedLines: number;
	readonly reason: string;
}

function lineCount(text: string): number {
	return text.length === 0 ? 0 : text.split("\n").length;
}

/** Count lines that differ between two files, position-independently (a moved line still counts as changed). */
function changedLineCount(original: string, merged: string): number {
	const before = original.split("\n");
	const after = merged.split("\n");
	const remaining = new Map<string, number>();
	for (const line of before) {
		remaining.set(line, (remaining.get(line) ?? 0) + 1);
	}
	let unchanged = 0;
	for (const line of after) {
		const count = remaining.get(line) ?? 0;
		if (count > 0) {
			remaining.set(line, count - 1);
			unchanged += 1;
		}
	}
	return Math.max(before.length, after.length) - unchanged;
}

/**
 * Judge whether a merged file changed only about as much as the intended edit. **The caller MUST run this before
 * writing the merged content.** An over-broad rewrite is REJECTED rather than accepted-with-a-warning: this rung
 * exists to rescue a failed edit, and a rescue that quietly rewrites unrelated code is worse than the failure it
 * was rescuing.
 */
export function assessIntentMergeSafety(input: IntentMergeSafetyInput): IntentMergeSafety {
	const intendedLines = lineCount(input.attemptedReplace.trim());
	const allowedLines = intendedLines + Math.max(0, input.slackLines ?? 3);
	const changedLines = changedLineCount(input.original, input.merged);

	if (input.merged.trim().length === 0) {
		return {
			accepted: false,
			changedLines,
			allowedLines,
			reason: "merged content is empty — refusing to blank the file",
		};
	}
	if (changedLines === 0) {
		return {
			accepted: false,
			changedLines,
			allowedLines,
			reason: "merged file is identical to the original — the model declined the edit, so there is nothing to apply",
		};
	}
	if (changedLines > allowedLines) {
		return {
			accepted: false,
			changedLines,
			allowedLines,
			reason: `merge changed ${changedLines} line(s) but the intended edit accounts for at most ${allowedLines} — REJECTED as an over-broad rewrite (this rung rescues a failed edit; it must not quietly rewrite unrelated code)`,
		};
	}
	return {
		accepted: true,
		changedLines,
		allowedLines,
		reason: `merge changed ${changedLines} line(s), within the ${allowedLines} the intended edit accounts for`,
	};
}
