/**
 * The PLAN-REVIEW round of the step-planning stage — PURE: the reviewer's checklist (explicit and testable), the
 * verdict schema the reviewer submits, and the bounded round decision.
 *
 * A plan is executed only after a reviewer (a stronger model or a second pass) approved it. The reviewer answers a
 * FIXED checklist so its judgment is auditable: each finding names a category from {@link STEP_PLAN_REVIEW_CHECKLIST},
 * optionally the step it concerns, and the concrete fix. A `revise` verdict without findings is refused (a bounce the
 * planner cannot act on is a wasted round — the same rule `submit_review` applies to `request_changes`).
 *
 * Rounds are bounded: after `maxRounds` unresolved revisions the card falls back to the ordinary worker path and says
 * so — an unreviewable plan must never wedge a card, and the fallback is the path that exists today.
 */

import { z } from "zod";
import type { StepPlanSubmission } from "./step-plan";

export const STEP_PLAN_REVIEW_CATEGORIES = [
	"completeness",
	"ambiguity",
	"missing_files",
	"wrong_assumption",
	"unsafe_step",
	"acceptance_unprovable",
	"fact_from_memory",
	"too_large_for_tier",
	"other",
] as const;
export type StepPlanReviewCategory = (typeof STEP_PLAN_REVIEW_CATEGORIES)[number];

/** The checklist, one question per category — rendered verbatim into the reviewer prompt and asserted by tests. */
export const STEP_PLAN_REVIEW_CHECKLIST: Readonly<Record<StepPlanReviewCategory, string>> = {
	completeness:
		"Does the sequence of steps, executed exactly as written, satisfy the whole card objective and its acceptance check? Name any requirement no step covers.",
	ambiguity:
		"Could a small model reading ONE step in isolation execute it without deciding anything? Flag every step that leaves a choice (which file, which function, which value, which approach).",
	missing_files:
		"Does every step name the exact workspace-relative files and symbols it touches, and do those files exist (or does a step create them)? Flag references to files/symbols that do not exist.",
	wrong_assumption:
		"Are the planner's assumptions and the intent of each step consistent with the repository as it is? Flag any assumption the code contradicts.",
	unsafe_step:
		"Does any step delete or rewrite files outside its scope, weaken tests, disable checks, or run a command that could damage the workspace? Flag it.",
	acceptance_unprovable:
		"Does every step's acceptance actually prove its expected outcome, preferably with a command? Flag acceptance that is vague, unrunnable, or proves something else.",
	fact_from_memory:
		"Does any step state an API signature, version number, library behaviour or real-world value as fact WITHOUT a verify block, where a lookup exists? Flag it; the plan must verify, not remember.",
	too_large_for_tier:
		"Is any step too broad for its declared difficulty (multi-file, multi-concern, or a judgment-heavy change tagged trivial/easy)? Flag it so it can be split or re-tagged.",
	other: "Anything else that would make a step fail when executed literally.",
};

export const stepPlanReviewFindingSchema = z.object({
	category: z.preprocess(
		(value) =>
			typeof value === "string"
				? value
						.trim()
						.toLowerCase()
						.replace(/[\s-]+/g, "_")
				: value,
		z.enum(STEP_PLAN_REVIEW_CATEGORIES).catch("other"),
	),
	/** Tolerant: a missing/junk step id means "the plan as a whole". */
	stepId: z.preprocess(
		(value) => (typeof value === "string" && value.trim() ? value.trim() : null),
		z.string().nullable(),
	),
	fix: z.string().trim().min(1),
});
export type StepPlanReviewFinding = z.infer<typeof stepPlanReviewFindingSchema>;

export const stepPlanReviewSubmissionSchema = z
	.object({
		verdict: z.enum(["approve", "revise"]),
		summary: z.string().trim().min(1),
		findings: z.preprocess(
			(value) => (Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]),
			z.array(stepPlanReviewFindingSchema),
		),
	})
	.refine((value) => value.verdict === "approve" || value.findings.length > 0, {
		message: "at least one finding is required when verdict is revise",
		path: ["findings"],
	});
export type StepPlanReviewSubmission = z.infer<typeof stepPlanReviewSubmissionSchema>;

export interface StepPlanReviewResult {
	verdict: "approve" | "revise";
	summary: string;
	findings: StepPlanReviewFinding[];
}

/** The findings as the planner must read them — category, target step, concrete fix. */
export function renderReviewFindings(findings: readonly StepPlanReviewFinding[]): string {
	return findings
		.map((finding) => `- [${finding.category}]${finding.stepId ? ` step ${finding.stepId}:` : ""} ${finding.fix}`)
		.join("\n");
}

/** Categories that name a step the plan does not contain are still findings — but the planner needs to know. */
export function findingsNamingUnknownSteps(
	plan: Pick<StepPlanSubmission, "steps">,
	findings: readonly StepPlanReviewFinding[],
): StepPlanReviewFinding[] {
	const ids = new Set(plan.steps.map((step) => step.id));
	return findings.filter((finding) => finding.stepId !== null && !ids.has(finding.stepId));
}

// ---------------------------------------------------------------------------
// Bounded rounds
// ---------------------------------------------------------------------------

export const DEFAULT_STEP_PLAN_MAX_REVIEW_ROUNDS = 2;

export type StepPlanReviewRoundAction =
	/** The reviewer approved: execute. */
	| "execute"
	/** The reviewer asked for changes and rounds remain: send the findings to the planner and review again. */
	| "revise"
	/** Rounds are exhausted (or the reviewer never answered past the bound): fall back to the unplanned worker path. */
	| "fallback_unplanned"
	/** No reviewer could be found for the first round: the plan runs unreviewed ONLY when the caller allows it. */
	| "execute_unreviewed";

export interface StepPlanReviewRoundInput {
	/** 1-based round number of the verdict being decided. */
	round: number;
	maxRounds: number;
	/** The verdict, or null when no reviewer session produced one. */
	verdict: "approve" | "revise" | null;
	/** Whether a missing verdict may waive review (only sane when no reviewer model exists at all, never mid-lineage). */
	allowUnreviewedWhenNoVerdict: boolean;
}

export interface StepPlanReviewRoundDecision {
	action: StepPlanReviewRoundAction;
	reason: string;
}

export function decideStepPlanReviewRound(input: StepPlanReviewRoundInput): StepPlanReviewRoundDecision {
	if (input.verdict === "approve") {
		return { action: "execute", reason: `plan approved in review round ${input.round}` };
	}
	if (input.verdict === null) {
		if (input.round === 1 && input.allowUnreviewedWhenNoVerdict) {
			return {
				action: "execute_unreviewed",
				reason: "no plan reviewer available; executing unreviewed (waiver surfaced)",
			};
		}
		return {
			action: "fallback_unplanned",
			reason: `review round ${input.round} produced no verdict — refusing to execute an unreviewed revision`,
		};
	}
	if (input.round >= input.maxRounds) {
		return {
			action: "fallback_unplanned",
			reason: `review rounds exhausted (${input.round}/${input.maxRounds}) without approval — falling back to the unplanned worker path`,
		};
	}
	return {
		action: "revise",
		reason: `reviewer requested changes in round ${input.round}; ${input.maxRounds - input.round} round(s) remain`,
	};
}

/** Renders the checklist as the reviewer prompt section (ordered, numbered, category id shown so the model reuses it). */
export function renderStepPlanReviewChecklist(): string {
	return STEP_PLAN_REVIEW_CATEGORIES.filter((category) => category !== "other")
		.map((category, index) => `${index + 1}. ${category}: ${STEP_PLAN_REVIEW_CHECKLIST[category]}`)
		.join("\n");
}
