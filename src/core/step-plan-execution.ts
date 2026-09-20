/**
 * EXECUTION against an approved step plan — PURE decisions for the one-step-at-a-time controller.
 *
 * The worker gets ONE step's instruction and hands the step back through `complete_step`. The harness then runs the
 * step's acceptance command in the worker's sandbox and this module decides what the tool RESULT says: advance to
 * the next step, retry this step (bounded), replan, or deliver. Keeping the decision pure means the controller's
 * wiring is thin and every branch is unit-tested without a sandbox.
 */

import { nextPendingStep, type StepPlan, type StepPlanStep, stepStatus } from "./step-plan";

export const DEFAULT_STEP_MAX_ATTEMPTS = 2;

export interface StepCompletionRequest {
	stepId: string;
	note: string;
	citations: readonly string[];
	/** The worker reports it cannot do the step as written (a question, a missing input, a contradiction). */
	blocked: string | null;
}

export interface StepAcceptanceRun {
	/** null ⇒ the step declared no command (accepted on the worker's word + the reviewer-approved check). */
	exitCode: number | null;
	output: string;
}

export interface StepCompletionDecisionInput {
	plan: Pick<StepPlan, "steps" | "outcomes">;
	request: StepCompletionRequest;
	acceptance: StepAcceptanceRun | null;
	/** Attempts already recorded for this step in the current revision (failed outcomes). */
	attemptsSoFar: number;
	maxAttempts: number;
	/** Receipt ids known for this card — a verify step's citations must intersect them. */
	knownReceiptUrls: ReadonlySet<string>;
}

export type StepCompletionDecision =
	| { action: "advance"; step: StepPlanStep; next: StepPlanStep }
	| { action: "deliver"; step: StepPlanStep }
	| { action: "retry"; step: StepPlanStep; reason: string; attempt: number }
	| { action: "replan"; step: StepPlanStep; trigger: "step_failed" | "worker_blocked"; reason: string }
	| { action: "reject"; reason: string };

export function decideStepCompletion(input: StepCompletionDecisionInput): StepCompletionDecision {
	const step = input.plan.steps.find((candidate) => candidate.id === input.request.stepId);
	if (!step) {
		const expected = nextPendingStep(input.plan);
		return {
			action: "reject",
			reason: `unknown step id "${input.request.stepId}"${expected ? `; the current step is "${expected.id}"` : ""}`,
		};
	}
	const current = nextPendingStep(input.plan);
	if (current && current.id !== step.id) {
		return {
			action: "reject",
			reason: `step "${step.id}" is not the current step; complete "${current.id}" first (steps are executed in order)`,
		};
	}
	if (stepStatus(input.plan, step.id) === "done") {
		return { action: "reject", reason: `step "${step.id}" is already done` };
	}
	if (input.request.blocked?.trim()) {
		return { action: "replan", step, trigger: "worker_blocked", reason: input.request.blocked.trim() };
	}
	if (step.verify) {
		const cited = input.request.citations.filter((url) => input.knownReceiptUrls.has(url));
		if (cited.length === 0) {
			return {
				action: "retry",
				step,
				attempt: input.attemptsSoFar + 1,
				reason:
					"this is a verify step: call lookup for the claim and pass the URL(s) you relied on as `citations` — none of the citations given matches a lookup receipt for this card",
			};
		}
	}
	if (input.acceptance && input.acceptance.exitCode !== null && input.acceptance.exitCode !== 0) {
		const attempt = input.attemptsSoFar + 1;
		if (attempt >= input.maxAttempts) {
			return {
				action: "replan",
				step,
				trigger: "step_failed",
				reason: `acceptance failed ${attempt}× (exit ${input.acceptance.exitCode}): ${input.acceptance.output}`,
			};
		}
		return {
			action: "retry",
			step,
			attempt,
			reason: `acceptance command exited ${input.acceptance.exitCode}: ${input.acceptance.output}`,
		};
	}
	// Accepted: the next pending step AFTER this one (treat this one as done for the lookup).
	const remaining = input.plan.steps.filter(
		(candidate) => candidate.id !== step.id && !["done", "skipped"].includes(stepStatus(input.plan, candidate.id)),
	);
	const next = remaining[0] ?? null;
	return next ? { action: "advance", step, next } : { action: "deliver", step };
}

/** Bound acceptance output for a tool result / history entry: keep the head and the tail, drop the middle. */
export function boundAcceptanceOutput(output: string, maxChars = 1_600): string {
	const trimmed = output.trim();
	if (trimmed.length <= maxChars) {
		return trimmed;
	}
	const half = Math.floor(maxChars / 2);
	return `${trimmed.slice(0, half)}\n[… ${trimmed.length - maxChars} chars elided …]\n${trimmed.slice(-half)}`;
}

/** The instruction appended to the final `complete_step` result once every step is accepted. */
export const STEP_PLAN_DELIVER_INSTRUCTION =
	"All planned steps are accepted. Finish the card now: run the card's own acceptance check if it has one, make sure the workspace is clean of scratch files, and end your turn with a short summary of what changed. Do not start new work.";
