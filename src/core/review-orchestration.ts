/**
 * Second-opinion review orchestration core (todo.md §5.K).
 *
 * Pure helpers that turn a reviewer-role verdict into a concrete board action, sitting between the
 * stateless {@link decideReviewLoopAction} decision and the live runtime that starts reviewer sessions and
 * mutates the board. Keeping prompt-building, work/feedback fingerprinting, and the verdict→transition mapping
 * here (no SDK, no I/O) makes the whole review flow unit-testable without a live model or workspace.
 *
 * The live orchestrator (runtime-state-hub) is then mechanical: read the card's review history → compute the
 * round → {@link buildReviewSeedPrompt} → start a reviewer session with the `submit_review` tool → on the
 * verdict call {@link resolveReviewTransition} → apply the returned board mutation + drive sessions.
 */

import { createHash } from "node:crypto";
import type { ReviewLens } from "./review-lenses.js";
import {
	DEFAULT_MAX_REVIEW_ROUNDS,
	decideReviewLoopAction,
	type ReviewRoundRecord,
	type ReviewVerdict,
} from "./review-loop.js";
import { fenceUntrustedContent } from "./untrusted-content-boundary.js";

/** A reviewer's structured verdict, mirroring `NKleinReviewSubmission` without the SDK/zod dependency. */
export interface ReviewSubmissionInput {
	verdict: ReviewVerdict;
	summary: string;
	feedback: string | null;
	insight: string | null;
	/** §5.AW: the reviewer's A/B pick when the seed presented two candidates; absent/null otherwise. */
	preferred?: "primary" | "speculative" | null;
	/**
	 * §5.AB panel (2026-07-07): the reviewer marks a `request_changes` as a BLOCKING security/correctness concern (vs an
	 * advisory nit). In the parallel panel this VETOES a merge even against a passing majority; a single reviewer treats
	 * it the same as any `request_changes`. Optional/absent ⇒ non-blocking (advisory), so existing submissions are unchanged.
	 */
	blocking?: boolean;
}

/**
 * Stable short fingerprint of a review artifact (a diff, or a feedback string), used for stall / identical-loop
 * detection. Trimmed-empty input fingerprints to `null` so "no work" / "no feedback" never matches another.
 */
export function fingerprintReviewArtifact(value: string | null | undefined): string | null {
	const text = value?.trim();
	if (!text) {
		return null;
	}
	return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export interface ShouldReviewCardInput {
	/** The second-opinion-review setting (default on); false skips review entirely. */
	enabled: boolean;
	/** Board column the card is in when it became reviewable. Only `review` cards get a second opinion. */
	columnId: string;
	/** True when this card is itself a reviewer card — never review a review (recursion guard). */
	isReviewerCard: boolean;
	/** True for planning/decomposition cards, which are not worker output and are skipped. */
	isPlanningCard: boolean;
}

/**
 * Whether a card that just became reviewable should get a second-opinion review pass. A card with **no file
 * changes** is still reviewed on purpose: a no-op result usually signals bad planning or a mis-processed task,
 * so the reviewer should judge whether "no change" is genuinely valid rather than letting it silently deliver.
 */
export function shouldReviewCard(input: ShouldReviewCardInput): boolean {
	return input.enabled && input.columnId === "review" && !input.isReviewerCard && !input.isPlanningCard;
}

/** A related card surfaced to the reviewer for board-context judgment (dependency / sibling). */
export interface ReviewRelatedCard {
	title: string;
	/** Current board column (e.g. "completed", "in_progress"), so the reviewer knows what's actually done. */
	column: string;
}

/** The card's place in the wider board/plan, so the reviewer can judge it in context, not in isolation. */
export interface ReviewBoardContext {
	/** The overall plan/project objective this card serves (its decomposition plan), when known. */
	planObjective?: string | null;
	/** Cards this card depends on — its prerequisites / upstream work it should build on. */
	dependsOn?: ReviewRelatedCard[];
	/** Cards that depend on this one — downstream work that will build on its result. */
	dependedOnBy?: ReviewRelatedCard[];
	/** Other cards from the same decomposition plan (siblings), for whole-plan coherence. */
	siblings?: ReviewRelatedCard[];
}

export interface ReviewSeedPromptInput {
	taskTitle: string;
	/** The card objective (its prompt) so the reviewer judges against intent, not just the diff. */
	taskObjective: string;
	/** The worker's diff to review. */
	diff: string;
	/**
	 * §5.AW best-of-N arbitration: a speculative mirror's diff for the SAME card (a different model's
	 * independent attempt). When present and non-empty, the seed presents BOTH diffs labeled Candidate A
	 * (primary) / Candidate B (speculative) and instructs the reviewer to name `preferred` in `submit_review`.
	 */
	speculativeDiff?: string | null;
	/**
	 * F12.4 execution-based arbitration: the prompt-ready note from `arbitrateByExecution` — the acceptance check
	 * run against BOTH candidates, folded into one sentence. Rendered only in the A/B seed (it is meaningless for
	 * a single candidate); absent or empty ⇒ byte-identical prompt.
	 */
	executionNote?: string | null;
	/** The worker's own final summary of what it did and why — so the reviewer judges the reasoning, not just the diff. */
	workerReasoning?: string | null;
	/** The card's place in the wider board/plan, so the reviewer can judge fit, scope, and coherence. */
	boardContext?: ReviewBoardContext | null;
	/** Human acceptance-gate summary, when an acceptance check ran (e.g. "Acceptance check passed: npm test."). */
	acceptanceSummary?: string | null;
	/**
	 * F12.54 risk-aware routing: the prompt-ready directive from `classifyDiffReviewRisk` (deep-review + failure-mode
	 * demand for high-risk surface, fast-track for docs/tests, fatigue warning past ~400 added lines). Absent or
	 * empty ⇒ the seed is byte-identical to the un-routed prompt.
	 */
	riskDirective?: string | null;
	/** 1-based current review round. */
	round: number;
	/** The previous round's change-request feedback, included when re-reviewing so the reviewer can verify it. */
	priorFeedback?: string | null;
	/**
	 * The worker's self-authored focus chain (its plan-of-attack checklist for this card, todo §5.N), formatted via
	 * `formatFocusChainForPrompt`, so the reviewer can judge whether the work actually followed/completed its plan.
	 */
	focusChain?: string | null;
	/**
	 * §5.AW review-panel lenses: explicit orthogonal perspectives (from {@link planReviewPanel} → {@link assignReviewLenses})
	 * the reviewer should look through, so an extra eye adds a DIFFERENT view rather than re-deriving the same findings.
	 * Absent or empty ⇒ the seed is byte-identical to the un-lensed prompt (the section is omitted entirely).
	 */
	lenses?: readonly ReviewLens[];
}

const REVIEW_REASONING_BUDGET = 6_000;

function formatRelatedCards(cards: ReviewRelatedCard[] | undefined): string | null {
	if (!cards || cards.length === 0) {
		return null;
	}
	return cards.map((card) => `- ${card.title} [${card.column}]`).join("\n");
}

function formatBoardContext(context: ReviewBoardContext | null | undefined): string[] {
	if (!context) {
		return [];
	}
	const lines: string[] = [];
	if (context.planObjective?.trim()) {
		lines.push("", "## Plan objective (what this card serves)", context.planObjective.trim());
	}
	const dependsOn = formatRelatedCards(context.dependsOn);
	const dependedOnBy = formatRelatedCards(context.dependedOnBy);
	const siblings = formatRelatedCards(context.siblings);
	if (dependsOn || dependedOnBy || siblings) {
		lines.push("", "## Board context (judge this card in the whole plan, not in isolation)");
		if (dependsOn) {
			lines.push("Depends on (prerequisites this work should build on):", dependsOn);
		}
		if (dependedOnBy) {
			lines.push("Depended on by (downstream cards that will build on this):", dependedOnBy);
		}
		if (siblings) {
			lines.push("Sibling cards in the same plan:", siblings);
		}
		lines.push(
			"Flag scope drift, duplication of a sibling's work, work that belongs in another card, or output that won't satisfy what downstream cards need.",
		);
	}
	return lines;
}

const REVIEW_DIFF_BUDGET = 24_000;

/**
 * S6 (Phase 7S): fence peer-worker output so the reviewer treats it as DATA under review, never as instructions.
 * A different agent (the worker) produced this text; a malicious or injection-echoing worker must not be able to
 * hijack the reviewer via imperative text in its diff/reasoning/focus-chain. The fence wraps the content in an
 * explicit `<<<BEGIN/END UNTRUSTED CONTENT>>>` boundary led by a data-not-commands preamble and NEUTRALIZES any
 * fence markers hidden in the content (no break-out). Screening is disabled (`screen: false`) ON PURPOSE: a worker's
 * diff legitimately contains injection-looking text when the card itself is about security, so a `block`/quarantine
 * would withhold the very diff the reviewer must judge. The structural boundary — S2's primary defense — is the point
 * here, not the heuristic filter.
 */
function fencePeerContent(content: string, source: string): string {
	return fenceUntrustedContent(content, { source, screen: false }).text;
}

function clampDiffForReview(diff: string, budget: number = REVIEW_DIFF_BUDGET): string {
	const trimmed = diff.trim();
	if (trimmed.length <= budget) {
		return trimmed;
	}
	return `${trimmed.slice(0, budget)}\n… diff truncated (${trimmed.length - budget} more characters); review what is shown and the stated objective.`;
}

/**
 * The reviewer-role seed prompt: a focused, second-opinion review brief that ends by requiring a single
 * `submit_review` tool call. Brevity is emphasized for the same local-model context-budget reasons as the
 * decomposition/efficiency prompts elsewhere.
 */
export function buildReviewSeedPrompt(input: ReviewSeedPromptInput): string {
	const lines: string[] = [
		`You are the second-opinion reviewer for the card "${input.taskTitle}" (review round ${input.round}).`,
		"A different agent implemented this card. Give it a real peer review, like a good senior engineer on a dev team: confirm it actually meets the objective and is sound, or request concrete changes. A clean approval from a second perspective is itself valuable — do not invent problems.",
		"Be critical about file size and structure: flag any file this change makes large or monolithic, or that should have been decomposed into cohesive modules — the codebase must not accumulate large monolith files, and growing files should be split early. Keep it proportionate: a brief, pointed note when it matters, not a line-by-line size audit.",
		"",
		"## Card objective",
		input.taskObjective.trim() || "(no objective recorded)",
	];
	lines.push(...formatBoardContext(input.boardContext));
	if (input.acceptanceSummary?.trim()) {
		lines.push("", "## Acceptance check", input.acceptanceSummary.trim());
	}
	if (input.priorFeedback?.trim()) {
		lines.push("", "## Your previous change request (verify it was addressed)", input.priorFeedback.trim());
	}
	if (input.riskDirective?.trim()) {
		lines.push("", "## Review routing for THIS diff", input.riskDirective.trim());
	}
	if (input.lenses && input.lenses.length > 0) {
		lines.push(
			"",
			"## Review specifically through these lenses",
			"Look through each assigned lens below (each is an orthogonal perspective — spend your attention where it says, not on a generic once-over):",
			...input.lenses.map((lens) => `- ${lens.stance}`),
		);
	}
	const hasDiff = input.diff.trim().length > 0;
	const speculativeDiff = input.speculativeDiff?.trim() ?? "";
	const isArbitration = hasDiff && speculativeDiff.length > 0;
	if (isArbitration) {
		// §5.AW best-of-N: both candidates share the single-diff budget so an A/B seed never doubles the
		// reviewer's context cost. A (primary) is the card's own worker; B is the speculative mirror.
		const perCandidateBudget = Math.floor(REVIEW_DIFF_BUDGET / 2);
		lines.push(
			"",
			"## Two candidate implementations (A/B review)",
			"This card was implemented twice, independently: Candidate A by the card's assigned worker, Candidate B by a different model working speculatively. Review BOTH against the objective and pick the one to deliver.",
			"",
			"### Candidate A — primary",
			fencePeerContent(
				clampDiffForReview(input.diff, perCandidateBudget),
				`worker diff (Candidate A) for "${input.taskTitle}"`,
			),
			"",
			"### Candidate B — speculative",
			fencePeerContent(
				clampDiffForReview(speculativeDiff, perCandidateBudget),
				`worker diff (Candidate B) for "${input.taskTitle}"`,
			),
		);
		// F12.4: the execution signal (self-labeled "Execution signal: …", so it renders bare). Decisive or tie,
		// the reviewer is told what actually RAN — judgment stays theirs; the note is evidence, not a verdict.
		if (input.executionNote?.trim()) {
			lines.push("", input.executionNote.trim());
		}
	} else if (hasDiff) {
		lines.push(
			"",
			"## Diff under review",
			fencePeerContent(clampDiffForReview(input.diff), `worker diff for "${input.taskTitle}"`),
		);
	} else {
		lines.push(
			"",
			"## No file changes",
			"The worker reported this card complete but made **no file changes**. A no-op result is usually a red flag — it often means the task was misunderstood, mis-scoped, already done, or not actually performed (bad planning or wrong task processing) — not a correct outcome. Judge against the objective: `approve` only if doing nothing is genuinely the right result here; otherwise `request_changes` explaining what the implementer should actually do.",
		);
	}
	if (input.workerReasoning?.trim()) {
		const reasoning = input.workerReasoning.trim();
		const clamped =
			reasoning.length > REVIEW_REASONING_BUDGET
				? `${reasoning.slice(0, REVIEW_REASONING_BUDGET)}\n… reasoning truncated.`
				: reasoning;
		lines.push(
			"",
			"## Worker's reasoning",
			"The implementer's own account of what it did and why. Judge the *reasoning*, not just the diff: a tidy-looking change built on a wrong assumption, or a 'no changes' justified by faulty reasoning, still warrants `request_changes`.",
			fencePeerContent(clamped, `worker reasoning for "${input.taskTitle}"`),
		);
	}
	if (input.focusChain?.trim()) {
		lines.push(
			"",
			"## Worker's focus chain (its self-authored plan)",
			"The implementer's own ordered checklist for this card. Judge whether the work actually followed and completed its own plan — steps left unfinished or skipped that matter to the objective warrant `request_changes`; a chain whose done steps don't match the diff is a red flag.",
			fencePeerContent(input.focusChain.trim(), `worker focus chain for "${input.taskTitle}"`),
		);
	}
	lines.push(
		"",
		"## How to review",
		isArbitration
			? "- Inspect BOTH candidates against the objective and the board context; read surrounding code only as needed."
			: hasDiff
				? "- Inspect the diff against the objective and the board context; read surrounding code only as needed."
				: "- Decide whether 'no changes' can possibly satisfy the objective; read the relevant files to confirm the work isn't actually needed before approving.",
		"- Keep your thinking and any prose brief — a short focused pass, then the tool call. Long output wastes the context budget.",
		isArbitration
			? '- Call `submit_review` exactly once with `preferred` set to `"primary"` (Candidate A) or `"speculative"` (Candidate B): `approve` delivers the preferred candidate; `request_changes` sends concrete feedback to the primary worker (judge the better candidate against the objective — correctness first, then scope discipline and code quality).'
			: "- Call `submit_review` exactly once: `approve` to sign off (a valued second-opinion confirmation), or `request_changes` with concrete, actionable feedback the implementer can act on directly.",
		"Do not implement changes yourself and do not answer in prose; the review is delivered only by the `submit_review` tool call.",
	);
	return lines.join("\n");
}

/** Worker bounce-back prompt carrying the reviewer's change request as the worker's next turn. */
export function buildReviewBouncePrompt(input: { round: number; summary: string; feedback: string }): string {
	return [
		`The second-opinion reviewer requested changes (review round ${input.round}).`,
		"",
		"## Reviewer summary",
		input.summary.trim(),
		"",
		"## Requested changes",
		input.feedback.trim(),
		"",
		// Weak local workers tend to reply in prose ("the code is already correct") and make NO edit, so the diff is
		// unchanged, the reviewer repeats the same request, and the card is parked after a wasted round (live-observed
		// 2026-07-11, qwen3-8b, habit-deep-chain). Lead with the concrete action — EDIT the file — and frame the
		// no-change reply as the narrow exception, so a small model is pushed to actually resolve the concern in code.
		"Address this by EDITING the relevant file(s) now: a prose-only reply leaves the code unchanged, so the reviewer will raise the same concern and the card will be parked without an edit. Make the change, then finish as usual so the card can be re-reviewed. Only if the request is genuinely mistaken and no code change is warranted should you instead make the smallest safe change that resolves the concern, or explain precisely why the current code is already correct in your final message.",
	].join("\n");
}

/** The reviewer's sign-off, recorded on the card when an approval proceeds to delivery. */
export function buildReviewSignOff(input: { summary: string; insight: string | null }): string {
	const insight = input.insight?.trim();
	return insight ? `${input.summary.trim()}\n\nInsight: ${insight}` : input.summary.trim();
}

export type ReviewTransition =
	| { action: "deliver"; reason: string; signOff: string; record: ReviewRoundRecord }
	| { action: "bounce_to_worker"; reason: string; workerPrompt: string; record: ReviewRoundRecord }
	/** W4.2 escalate-then-park: re-drive the card on a stronger/different-lineage worker before giving up. */
	| { action: "escalate_worker"; reason: string; workerPrompt: string; record: ReviewRoundRecord }
	| { action: "park"; reason: string; record: ReviewRoundRecord };

export interface ResolveReviewTransitionInput {
	submission: ReviewSubmissionInput;
	/** 1-based current review round (the round that just produced this verdict). */
	round: number;
	/** Fingerprint of the worker diff reviewed this round (from {@link fingerprintReviewArtifact}). */
	workFingerprint: string | null;
	/** Prior review rounds for this card, oldest first. */
	history: readonly ReviewRoundRecord[];
	maxRounds?: number;
	/** W4.2: an untried stronger/different-lineage worker exists (absent/false ⇒ historical park behavior). */
	escalationAvailable?: boolean;
	/** W4.2: this card already used its one escalation. */
	alreadyEscalated?: boolean;
}

/**
 * Map a reviewer verdict to a concrete board transition: deliver (with sign-off), bounce to the worker (with a
 * prompt carrying the feedback), or park (round limit / stall / identical loop). Also returns the
 * {@link ReviewRoundRecord} the caller should append to the card's review history.
 */
export function resolveReviewTransition(input: ResolveReviewTransitionInput): ReviewTransition {
	const feedbackFingerprint =
		input.submission.verdict === "request_changes" ? fingerprintReviewArtifact(input.submission.feedback) : null;
	const record: ReviewRoundRecord = {
		round: input.round,
		verdict: input.submission.verdict,
		feedbackFingerprint,
		workFingerprint: input.workFingerprint,
	};
	const decision = decideReviewLoopAction({
		verdict: input.submission.verdict,
		round: input.round,
		maxRounds: input.maxRounds ?? DEFAULT_MAX_REVIEW_ROUNDS,
		feedbackFingerprint,
		workFingerprint: input.workFingerprint,
		history: input.history,
		...(input.escalationAvailable !== undefined ? { escalationAvailable: input.escalationAvailable } : {}),
		...(input.alreadyEscalated !== undefined ? { alreadyEscalated: input.alreadyEscalated } : {}),
	});
	if (decision.action === "deliver") {
		return {
			action: "deliver",
			reason: decision.reason,
			signOff: buildReviewSignOff({ summary: input.submission.summary, insight: input.submission.insight }),
			record,
		};
	}
	if (decision.action === "bounce_to_worker" || decision.action === "escalate_worker") {
		return {
			action: decision.action,
			reason: decision.reason,
			workerPrompt: buildReviewBouncePrompt({
				round: input.round,
				summary: input.submission.summary,
				feedback: input.submission.feedback ?? "",
			}),
			record,
		};
	}
	return { action: "park", reason: decision.reason, record };
}
