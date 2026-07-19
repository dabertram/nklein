/**
 * F12.91 history-blind corrector role — a review pass that sees ONLY the objective + the proposed patch +
 * relevant spec/docs, and DELIBERATELY NEVER the conversation history, worker reasoning, or focus chain.
 *
 * The "Three Roles, One Model" result (2604.11465): history isolation is exactly what breaks error cascades — a
 * reviewer that shares the worker's context inherits its wrong assumptions and endorses them (~31.7% self-drift
 * endorsement); a corrector given ONLY the artifact + the spec judges the code fresh, so it catches what the
 * context-poisoned path missed. This role is DISTINCT from the second-opinion reviewer (which sees full context
 * on purpose) — the isolation is the feature, so the input type here has no history/reasoning/chain fields at
 * all (they cannot be passed in even by accident).
 *
 * Pure string construction. The patch and any spec excerpt are UNTRUSTED (worker/ingested content per S6/S2) and
 * are structurally fenced. The verdict is delivered by the same `submit_review` contract the reviewer uses, so
 * the caller's review-resolution path consumes it unchanged.
 */

import { fenceUntrustedContent } from "./untrusted-content-boundary.js";

/** Max chars of patch shown to the corrector (mirrors the reviewer diff budget). */
export const CORRECTOR_DIFF_BUDGET = 24_000;
/** Max chars of spec/docs excerpt (kept tight — the corrector judges against the OBJECTIVE, docs are support). */
export const CORRECTOR_SPEC_BUDGET = 6_000;

export interface HistoryBlindCorrectorInput {
	/** The card objective — what the change must achieve. The ONLY intent signal (no history to lean on). */
	readonly taskObjective: string;
	/** The proposed patch/diff to judge. Untrusted worker output → structurally fenced. */
	readonly diff: string;
	/**
	 * Relevant spec / doc excerpt the corrector should check the patch against, when the caller has one (e.g. a
	 * `specification.md` section, an API contract). Untrusted (may be ingested) → fenced. Absent ⇒ omitted.
	 */
	readonly specExcerpt?: string | null;
	/** Human acceptance-gate summary, when an acceptance check ran (e.g. "Acceptance check passed: npm test."). */
	readonly acceptanceSummary?: string | null;
}

function clampFenced(content: string, budget: number, source: string): string {
	const trimmed = content.trim();
	const clamped =
		trimmed.length > budget
			? `${trimmed.slice(0, budget)}\n… truncated (${trimmed.length - budget} more chars).`
			: trimmed;
	// screen:false — a patch legitimately contains injection-looking text when the card is about security; the
	// STRUCTURAL fence (S2) is the defense here, not the heuristic screen (same contract as the reviewer's fence).
	return fenceUntrustedContent(clamped, { source, screen: false }).text;
}

/**
 * Build the history-blind corrector seed prompt. The model is told, explicitly, that it is seeing the artifact
 * in ISOLATION (no history) so it must judge from the objective + code alone — that framing is what makes the
 * pass catch cascade errors. Ends by requiring a single `submit_review` call (approve / request_changes), same
 * as the reviewer, so the resolution path is shared.
 */
export function buildHistoryBlindCorrectorPrompt(input: HistoryBlindCorrectorInput): string {
	const lines: string[] = [
		"You are the HISTORY-BLIND corrector for a code change. You are seeing this change in ISOLATION — you do NOT have the conversation, the worker's reasoning, or its plan, and that is DELIBERATE: judge the code against the objective ALONE, so any wrong assumption the implementer carried does not carry to you.",
		"Read the objective, then the patch, then verify the patch actually achieves the objective and is correct on its own terms. You are the fresh-eyes check that catches an error the implementer talked itself into.",
		"",
		"## Objective (the only statement of intent — there is no history to fall back on)",
		input.taskObjective.trim() || "(no objective recorded)",
	];
	if (input.specExcerpt?.trim()) {
		lines.push(
			"",
			"## Relevant specification / docs (check the patch against THIS, not against what you'd assume)",
			clampFenced(input.specExcerpt, CORRECTOR_SPEC_BUDGET, "specification excerpt for the corrector"),
		);
	}
	if (input.acceptanceSummary?.trim()) {
		lines.push(
			"",
			"## Acceptance check",
			input.acceptanceSummary.trim(),
			"A green acceptance check is evidence, not proof — example tests can pass on code that still violates the objective. Judge the objective independently.",
		);
	}
	const hasDiff = input.diff.trim().length > 0;
	if (hasDiff) {
		lines.push(
			"",
			"## Proposed patch (the artifact — judge it on its own merits)",
			clampFenced(input.diff, CORRECTOR_DIFF_BUDGET, "worker patch under history-blind correction"),
		);
	} else {
		lines.push(
			"",
			"## No file changes",
			"The change made NO edits. Judge against the objective: `approve` only if doing nothing genuinely satisfies it; otherwise `request_changes` naming what the code must actually do.",
		);
	}
	lines.push(
		"",
		"## How to correct",
		"- Check the patch achieves the objective and is internally correct — wrong logic, missed cases, an assumption the code makes that the objective does not support.",
		"- You have no history, so do not speculate about why a choice was made; judge only whether the RESULT is right.",
		"- Call `submit_review` exactly once: `approve` if the change correctly meets the objective, or `request_changes` with concrete, actionable feedback the implementer can apply directly.",
		"Do not implement changes yourself and do not answer in prose; the correction is delivered only by the `submit_review` tool call.",
	);
	return lines.join("\n");
}
