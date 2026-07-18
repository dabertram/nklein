/**
 * F12.62 — Architect/Editor split per card (the biggest documented small-model win).
 *
 * A single small model splits its attention between SOLVING the problem and CONFORMING to the edit format — and
 * loses both (aider's architect mode: even same-model-twice beats solo, Sonnet 77.4%→80.5%; the effect is larger
 * the weaker the model). !Klein's live evidence points the same way: weak workers produce empty patches / burn
 * budget on huge structured turns (2026-07-18 tee forensics), while the same models handle prose reasoning and
 * simple tool calls fine.
 *
 * The split: an ARCHITECT turn reasons about the fix in prose/pseudocode (no file mutations — read/inspect only)
 * and ends with a compact IMPLEMENTATION BRIEF; an EDITOR turn converts that brief into exact edit-tool calls with
 * minimal thinking. This module is the PURE core: the split decision + both prompt builders + the brief extractor.
 * The effectful wire (running the architect as a bounded secondary session, seeding the editor with the brief)
 * follows the explorer/plan-critique harness pattern and lives with the session service.
 */

export interface ArchitectEditorSplitInput {
	/** The routed model's effective capability score (0–100, the routing prior's scale). */
	modelEffectiveScore: number | null;
	/** Task difficulty score (5–100, board scale) when known. */
	taskDifficulty: number | null;
	/** True when the card's work is write-scoped (declares files to touch / is an implementation card). */
	isWriteScoped: boolean;
	/** Consecutive malformed/empty-patch failures already recorded for this card (attempt ledger). */
	priorEditFailures?: number;
}

export interface ArchitectEditorSplitDecision {
	split: boolean;
	reason: string;
}

/**
 * Models at/above this effective score reliably handle solve+format in one pass — splitting them wastes a session.
 * Below it, the documented aider effect dominates. 60 ≈ the fleet's proven solo-worker tier boundary (qwable-27b
 * class sits in the 50s and produced the empty-patch evidence; 70+ cloud-class models don't run locally here).
 */
export const SOLO_CAPABLE_EFFECTIVE_SCORE = 60;

/** Difficulty at/below which the edit is trivial enough that a solo pass wins regardless of model tier. */
export const TRIVIAL_DIFFICULTY_CEILING = 20;

/**
 * Decide whether this card's implementation should run as architect → editor instead of one solo worker session.
 * Pure + deterministic; unknown inputs fail toward SOLO (the split costs a whole extra session — opt in only on
 * evidence). Any prior edit-format failure forces the split regardless of scores: the solo pass already proved it
 * can't conform.
 */
export function decideArchitectEditorSplit(input: ArchitectEditorSplitInput): ArchitectEditorSplitDecision {
	if (!input.isWriteScoped) {
		return { split: false, reason: "not a write-scoped card — nothing for an editor phase to apply" };
	}
	if ((input.priorEditFailures ?? 0) >= 1) {
		return {
			split: true,
			reason: `prior edit-format failure (${input.priorEditFailures}) — solo pass already failed to conform; split solve from format`,
		};
	}
	if (input.taskDifficulty !== null && input.taskDifficulty <= TRIVIAL_DIFFICULTY_CEILING) {
		return {
			split: false,
			reason: `trivial difficulty ${input.taskDifficulty} — solo pass is cheaper and sufficient`,
		};
	}
	if (input.modelEffectiveScore === null) {
		return { split: false, reason: "unknown model capability — default solo (split only on evidence)" };
	}
	if (input.modelEffectiveScore >= SOLO_CAPABLE_EFFECTIVE_SCORE) {
		return {
			split: false,
			reason: `model score ${input.modelEffectiveScore} ≥ ${SOLO_CAPABLE_EFFECTIVE_SCORE} — solo-capable tier`,
		};
	}
	return {
		split: true,
		reason: `model score ${input.modelEffectiveScore} < ${SOLO_CAPABLE_EFFECTIVE_SCORE} on non-trivial work — architect/editor split pays (aider architect effect)`,
	};
}

/** Sentinel heading the architect must emit; the extractor anchors on it. */
export const IMPLEMENTATION_BRIEF_HEADING = "IMPLEMENTATION BRIEF";

/**
 * Build the ARCHITECT phase prompt: reason in prose, inspect freely, mutate nothing, end with the brief.
 * The brief format is intent-level (file + location + what changes and why) — NOT diffs; exact-diff conformance is
 * precisely the burden the split removes from the reasoning pass.
 */
export function buildArchitectPrompt(args: { taskPrompt: string }): string {
	return [
		"You are the ARCHITECT for this card. Your job is to SOLVE the problem in prose — you do NOT edit files.",
		"Inspect the code with the read/search tools as needed, then decide the fix.",
		"",
		"Task:",
		args.taskPrompt.trim(),
		"",
		`End your final message with a section titled "${IMPLEMENTATION_BRIEF_HEADING}" containing a numbered list of edits in intent form — for each: the file path, where in the file (function/anchor line text), and WHAT to change, precise enough that a mechanical editor can apply it without re-deriving your reasoning. Do not write diffs or full file bodies; do not call any write or edit tool.`,
	].join("\n");
}

/**
 * Build the EDITOR phase prompt: convert the architect's brief into exact edit-tool calls, minimal thinking.
 */
export function buildEditorPrompt(args: { taskPrompt: string; architectBrief: string }): string {
	return [
		"You are the EDITOR for this card. The solution is already decided — your ONLY job is to apply it exactly.",
		"Do not re-litigate the approach. Read each target location first, then apply the edits with the edit/write tools.",
		"",
		"Original task (context only):",
		args.taskPrompt.trim(),
		"",
		`${IMPLEMENTATION_BRIEF_HEADING} (apply these edits, in order):`,
		args.architectBrief.trim(),
	].join("\n");
}

/**
 * Extract the implementation brief from the architect's final prose. Anchors on the LAST occurrence of the heading
 * (models sometimes restate it while planning); returns null when absent or effectively empty so the caller can
 * fall back to a solo pass instead of seeding the editor with nothing.
 */
export function extractImplementationBrief(architectFinalText: string): string | null {
	const upper = architectFinalText.toUpperCase();
	const at = upper.lastIndexOf(IMPLEMENTATION_BRIEF_HEADING);
	if (at === -1) {
		return null;
	}
	const after = architectFinalText
		.slice(at + IMPLEMENTATION_BRIEF_HEADING.length)
		.replace(/^[\s:*#-]+/u, "")
		.trim();
	return after.length >= 20 ? after : null;
}
