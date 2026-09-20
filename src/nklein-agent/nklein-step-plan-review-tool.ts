/**
 * `submit_step_plan_review` — the PLAN REVIEWER's structured verdict for the step-planning stage, plus the reviewer
 * seed prompt with the explicit checklist (`step-plan-review.ts`). Mirrors `submit_plan_critique`: exactly one call,
 * `approve` or `revise` with findings the planner can act on; tolerant parsing (a rejected verdict call loops a small
 * model into the mistake guard and wastes the round — #15).
 */

import { renderStepPlanForReview, type StepPlan } from "../core/step-plan";
import {
	renderStepPlanReviewChecklist,
	STEP_PLAN_REVIEW_CATEGORIES,
	type StepPlanReviewResult,
	stepPlanReviewSubmissionSchema,
} from "../core/step-plan-review";
import type { AgentTool } from "./sdk-agent-types";

export const SUBMIT_STEP_PLAN_REVIEW_TOOL_NAME = "submit_step_plan_review";

export type NKleinStepPlanReviewSubmittedHandler = (result: StepPlanReviewResult) => void | Promise<void>;

export function createNKleinStepPlanReviewTool(options: {
	onSubmitted?: NKleinStepPlanReviewSubmittedHandler;
}): AgentTool {
	return {
		name: SUBMIT_STEP_PLAN_REVIEW_TOOL_NAME,
		description:
			"Submit your review of the step plan. Call this exactly once: `approve` (every step is executable as written) or `revise` with `findings` — each {category, stepId, fix} using a checklist category. Do not answer in prose.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: ["string", "null"], description: "Ignored. Do not include." },
				verdict: { type: "string", enum: ["approve", "revise"] },
				summary: { type: "string", description: "What you checked and the headline judgment." },
				findings: {
					type: "array",
					items: {
						type: "object",
						properties: {
							category: { type: "string", enum: [...STEP_PLAN_REVIEW_CATEGORIES] },
							stepId: {
								type: ["string", "null"],
								description: "The step the finding concerns, or null for the whole plan.",
							},
							fix: { type: "string", description: "The concrete change the planner must make." },
						},
					},
				},
			},
			required: [],
			additionalProperties: true,
		},
		async execute(input) {
			const parsed = stepPlanReviewSubmissionSchema.safeParse(input);
			if (!parsed.success) {
				return {
					ok: false,
					instruction:
						"Could not read the review. Call submit_step_plan_review with `verdict` (`approve` or `revise`), a non-empty `summary`, and — for `revise` — at least one finding {category, stepId, fix}.",
				};
			}
			const result: StepPlanReviewResult = {
				verdict: parsed.data.verdict,
				summary: parsed.data.summary,
				findings: parsed.data.findings,
			};
			await options.onSubmitted?.(result);
			return {
				ok: true,
				verdict: result.verdict,
				instruction:
					result.verdict === "approve"
						? "Review submitted: approve. Stop now; do not make further tool calls."
						: "Review submitted: revision requested. Stop now; !Klein will send your findings to the planner.",
			};
		},
	};
}

export interface StepPlanReviewSeedPromptInput {
	taskTitle: string | null;
	taskPrompt: string;
	plan: Pick<StepPlan, "objective" | "assumptions" | "steps" | "history" | "outcomes">;
	round: number;
	lookupAvailable: boolean;
}

/** The reviewer seed: the card (authoritative), the full plan, the numbered checklist, the one-call contract. */
export function buildStepPlanReviewSeedPrompt(input: StepPlanReviewSeedPromptInput): string {
	return [
		`You are the PLAN REVIEWER (round ${input.round}). A planner wrote a detailed step plan that a small local model will execute one step at a time, literally, without exploring or deciding. Your job is to find every way that execution would fail or produce the wrong thing — BEFORE any step runs.`,
		"",
		`Card${input.taskTitle ? ` "${input.taskTitle}"` : ""} (AUTHORITATIVE — the plan must satisfy it, not reinterpret it):`,
		input.taskPrompt.trim(),
		"",
		"## The plan under review",
		renderStepPlanForReview(input.plan),
		"",
		"## Checklist — answer every item against the repository (read files; do not trust the plan's claims)",
		renderStepPlanReviewChecklist(),
		"",
		input.lookupAvailable
			? "You have the lookup tool: when a step states a fact from memory where a lookup exists (checklist item fact_from_memory), you may look it up yourself — but the FINDING is still that the plan lacks a verify block; the executor must verify, not you."
			: "The lookup tool is not attached to this session; judge fact_from_memory by whether the step carries a verify block.",
		"",
		"Then call submit_step_plan_review EXACTLY ONCE: `approve` only if every step is executable as written and the sequence satisfies the card; otherwise `revise` with one finding per defect (category, stepId, concrete fix). A `revise` with vague findings wastes the round. Do not answer in prose.",
	].join("\n");
}
