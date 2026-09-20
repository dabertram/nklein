/**
 * REPLANNING with history — PURE: which divergences trigger a replan, how bounded it is, and the brief the planner
 * receives so the next revision does not repeat the mistakes of the last.
 *
 * Triggers (David: "whenever updates needed, everything properly replanned"):
 * - `step_failed`     a step's acceptance kept failing past the per-step attempt bound;
 * - `worker_blocked`  the worker reported it cannot execute the step as written (a question, a missing input);
 * - `review_bounce`   the delivery review requested changes (the plan produced the wrong thing);
 * - `base_changed`    the card's base ref moved under the plan (the codebase changed underneath);
 * - `user_steer`      the operator sent an instruction mid-execution.
 *
 * A replan produces a NEW revision that goes through the review round again. Done steps are carried as facts the new
 * plan must not redo; the failed attempt's evidence is retained verbatim (bounded) so "why it failed" survives.
 */

import { completedStepIds, type ReplanTrigger, type StepPlan, type StepPlanHistoryEntry } from "./step-plan";

export const DEFAULT_STEP_PLAN_MAX_REPLANS = 2;
/** Evidence carried into the brief is bounded — a 40 KB test log is not a lesson, its first failure is. */
export const REPLAN_EVIDENCE_CHAR_BUDGET = 2_400;

export interface ReplanDecisionInput {
	trigger: ReplanTrigger;
	/** Replans already spent on this card (plan.revision). */
	replanCount: number;
	maxReplans: number;
}

export interface ReplanDecision {
	action: "replan" | "exhausted";
	reason: string;
}

export function decideReplan(input: ReplanDecisionInput): ReplanDecision {
	if (input.replanCount >= input.maxReplans) {
		return {
			action: "exhausted",
			reason: `replan budget spent (${input.replanCount}/${input.maxReplans}) on trigger ${input.trigger} — falling back to the unplanned worker path`,
		};
	}
	return {
		action: "replan",
		reason: `replan ${input.replanCount + 1}/${input.maxReplans} on trigger ${input.trigger}`,
	};
}

export interface ReplanEvidence {
	trigger: ReplanTrigger;
	/** The step that failed / blocked, when the trigger is step-scoped. */
	stepId?: string | null;
	/** Acceptance output, the worker's blocked note, the reviewer's feedback, the steer text, or the base-ref pair. */
	detail: string;
	at: number;
}

function bound(text: string, budget: number): string {
	const trimmed = text.trim();
	return trimmed.length <= budget
		? trimmed
		: `${trimmed.slice(0, budget)}\n[truncated ${trimmed.length - budget} chars]`;
}

const TRIGGER_LABEL: Readonly<Record<ReplanTrigger, string>> = {
	step_failed: "a step failed its acceptance repeatedly",
	worker_blocked: "the worker could not execute a step as written",
	review_bounce: "the delivery review requested changes",
	base_changed: "the card's base commit changed under the plan",
	user_steer: "the operator sent a new instruction",
};

/** The history entry a replan appends BEFORE the new revision is written. */
export function buildReplanHistoryEntry(plan: StepPlan, evidence: ReplanEvidence): StepPlanHistoryEntry {
	const failedStep = evidence.stepId ? plan.steps.find((step) => step.id === evidence.stepId) : undefined;
	const summary = [
		`${TRIGGER_LABEL[evidence.trigger]}${failedStep ? ` (step ${failedStep.id} — ${failedStep.title})` : ""}.`,
		bound(evidence.detail, REPLAN_EVIDENCE_CHAR_BUDGET),
	].join(" ");
	return {
		revision: plan.revision,
		trigger: evidence.trigger,
		summary,
		completedStepIds: completedStepIds(plan),
		at: evidence.at,
	};
}

/**
 * The planner's re-prompt: the trigger, the retained evidence, the steps that are DONE (never redo), the steps that
 * were pending, and the lessons from every earlier revision. The planner resubmits a full plan for the REMAINING work.
 */
export function buildReplanBrief(plan: StepPlan, evidence: ReplanEvidence): string {
	const done = completedStepIds(plan);
	const doneSet = new Set(done);
	const remaining = plan.steps.filter((step) => !doneSet.has(step.id));
	const lines: string[] = [
		`[!Klein step plan — REPLAN request, revision ${plan.revision + 1}]`,
		`Reason: ${TRIGGER_LABEL[evidence.trigger]}${evidence.stepId ? ` (step ${evidence.stepId})` : ""}.`,
		"",
		"Evidence (what actually happened — read before planning):",
		bound(evidence.detail, REPLAN_EVIDENCE_CHAR_BUDGET),
	];
	if (done.length > 0) {
		lines.push(
			"",
			"Steps already DONE and accepted — their changes are in the workspace; do NOT plan them again:",
			...plan.steps.filter((step) => doneSet.has(step.id)).map((step) => `- ${step.id} — ${step.title}`),
		);
	}
	if (remaining.length > 0) {
		lines.push(
			"",
			"Steps that were still pending in the previous revision (revise, replace or drop them):",
			...remaining.map((step) => `- ${step.id} — ${step.title}: ${step.intent}`),
		);
	}
	if (plan.history.length > 0) {
		lines.push(
			"",
			"Lessons from earlier revisions (do not repeat these mistakes):",
			...plan.history.map(
				(entry) => `- revision ${entry.revision}${entry.trigger ? ` (${entry.trigger})` : ""}: ${entry.summary}`,
			),
		);
	}
	lines.push(
		"",
		"Submit a complete plan for the REMAINING work via submit_step_plan. Every step must be executable without judgment calls; a step that depends on a fact carries a verify block. Keep step ids of unchanged pending steps; give changed or new steps new ids.",
	);
	return lines.join("\n");
}
