/**
 * `submit_step_plan` — the PLANNER session's structured hand-back (the step-planning stage, David 2026-09-20), and
 * the planner's seed prompt. Same contract family as `submit_implementation_brief` / `submit_plan_critique`: the
 * deliverable arrives as ONE tool call (the proven structured channel for small local models), validated by the
 * pure `stepPlanSubmissionSchema` + `validateStepPlan`, with the tool RESULT carrying every violation so the planner
 * fixes them in one revision instead of a fix-validate-fix loop.
 */

import { z } from "zod";
import {
	MAX_STEP_PLAN_STEPS,
	STEP_DIFFICULTIES,
	type StepPlanSubmission,
	stepPlanSubmissionSchema,
	validateStepPlan,
} from "../core/step-plan";
import { renderReviewFindings, type StepPlanReviewFinding } from "../core/step-plan-review";
import type { AgentTool } from "./sdk-agent-types";

export const SUBMIT_STEP_PLAN_TOOL_NAME = "submit_step_plan";

export type NKleinStepPlanSubmittedHandler = (plan: StepPlanSubmission) => void | Promise<void>;

/** Tolerant envelope: models sometimes wrap the plan (`{ plan: {...} }`) or echo the tool name. */
const submissionEnvelopeSchema = z.preprocess((value) => {
	if (value && typeof value === "object" && "plan" in (value as Record<string, unknown>)) {
		const inner = (value as Record<string, unknown>).plan;
		if (inner && typeof inner === "object") {
			return inner;
		}
	}
	return value;
}, stepPlanSubmissionSchema);

export function createNKleinStepPlanTool(options: { onSubmitted?: NKleinStepPlanSubmittedHandler }): AgentTool {
	return {
		name: SUBMIT_STEP_PLAN_TOOL_NAME,
		description:
			"Submit the detailed step plan for this card. Call it exactly once with `objective`, `assumptions` and `steps` — each step with id, title, intent, files[{path, symbol, change}], commands, inputs, expectedOutcome, acceptance{command, check}, mustNot, difficulty (trivial|easy|medium|hard) and, when the step rests on a fact, verify{claim, query}. The plan is delivered ONLY by this call.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: ["string", "null"], description: "Ignored. Do not include." },
				objective: { type: "string", description: "The card objective in one sentence." },
				assumptions: { type: "array", items: { type: "string" }, description: "Assumptions the plan rests on." },
				steps: {
					type: "array",
					description: `Ordered steps (max ${MAX_STEP_PLAN_STEPS}).`,
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							title: { type: "string" },
							intent: { type: "string" },
							files: {
								type: "array",
								items: {
									type: "object",
									properties: {
										path: { type: "string", description: "Workspace-relative path." },
										symbol: { type: ["string", "null"] },
										change: { type: "string", description: "The concrete change, no judgment left." },
									},
								},
							},
							commands: { type: "array", items: { type: "string" } },
							inputs: { type: "array", items: { type: "string" } },
							expectedOutcome: { type: "string" },
							acceptance: {
								type: "object",
								properties: {
									command: { type: ["string", "null"], description: "Shell command; exit 0 = accepted." },
									check: { type: "string" },
								},
							},
							mustNot: { type: "array", items: { type: "string" } },
							difficulty: { type: "string", enum: [...STEP_DIFFICULTIES] },
							verify: {
								type: ["object", "null"],
								properties: { claim: { type: "string" }, query: { type: "string" } },
							},
						},
					},
				},
			},
			required: [],
			additionalProperties: true,
		},
		async execute(input) {
			const parsed = submissionEnvelopeSchema.safeParse(input);
			if (!parsed.success) {
				const issues = parsed.error.issues
					.slice(0, 6)
					.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
				return {
					ok: false,
					instruction: `Could not read the plan. Fix these fields and call submit_step_plan again: ${issues.join("; ")}.`,
				};
			}
			const validation = validateStepPlan(parsed.data);
			if (!validation.ok) {
				return {
					ok: false,
					instruction: `The plan is structurally invalid. Fix ALL of these and call submit_step_plan again:\n${validation.errors.map((error) => `- ${error}`).join("\n")}`,
				};
			}
			await options.onSubmitted?.(parsed.data);
			return { ok: true, instruction: "Plan recorded. Stop now; do not make further tool calls." };
		},
	};
}

export interface StepPlanSeedPromptInput {
	taskTitle: string | null;
	taskPrompt: string;
	/** The card's likely files / write scope when known — the planner starts from them instead of exploring blind. */
	filesLikelyTouched?: readonly string[] | null;
	writeScope?: readonly string[] | null;
	lookupAvailable: boolean;
	/** The fleet's weakest executing tier, in words, so the planner sizes steps for it ("a 9B coding model"). */
	executorDescription?: string | null;
	/** Reviewer findings from the previous round (a revision), or a replan brief. */
	revisionContext?: string | null;
}

/** The planner session's seed prompt: what a detailed step plan is, the bar it must meet, and the one-call contract. */
export function buildStepPlanSeedPrompt(input: StepPlanSeedPromptInput): string {
	const executor =
		input.executorDescription?.trim() ||
		"a small local model (9B class) with weak recall and no tolerance for ambiguity";
	const lines: string[] = [
		`You are the PLANNER for one card. You do not implement anything: you read the repository and write a DETAILED STEP PLAN that ${executor} can execute one step at a time WITHOUT exploring, deciding or improvising.`,
		"",
		`Card${input.taskTitle ? ` "${input.taskTitle}"` : ""}:`,
		input.taskPrompt.trim(),
	];
	if (input.filesLikelyTouched?.length) {
		lines.push("", `Files the card is expected to touch: ${input.filesLikelyTouched.join(", ")}`);
	}
	if (input.writeScope?.length) {
		lines.push(`Write scope (steps must stay inside): ${input.writeScope.join(", ")}`);
	}
	lines.push(
		"",
		"Rules for every step:",
		"- Name the exact workspace-relative file(s) and the symbol/section to touch, and state the change concretely (what to add/replace, with the actual names and values). Verify the files and symbols exist by reading them; do not guess.",
		"- Give the commands to run, in order, and an acceptance command that exits 0 only when the step is done (a focused test, a grep, a script). Say what the expected outcome is.",
		"- List what the step must NOT do (files it must not touch, refactors it must not attempt, tests it must not change).",
		"- Tag difficulty: trivial (one obvious edit), easy, medium, hard. Split anything that would need judgment into smaller steps; keep each step to as few files as possible.",
		`- Keep the plan to at most ${MAX_STEP_PLAN_STEPS} steps; if the card needs more, it must be split — say so in the assumptions.`,
		`- If a step's correctness depends on a FACT you may only know from memory (an API signature, a version number, a library's current behaviour, a real-world value), attach verify{claim, query}: the executor will look it up before acting.${input.lookupAvailable ? " You have the lookup tool too — use it now for facts the plan itself rests on, and cite the URL in the step's inputs." : ""}`,
		"- State your assumptions explicitly; the plan reviewer will challenge them.",
	);
	if (input.revisionContext?.trim()) {
		lines.push("", "Revision context (address every point):", input.revisionContext.trim());
	}
	lines.push(
		"",
		"Read what you need, then call submit_step_plan EXACTLY ONCE with the full plan. Do not answer in prose; the plan is delivered only by that tool call.",
	);
	return lines.join("\n");
}

/** The planner's re-prompt for a review round: the findings verbatim + the resubmission contract. */
export function buildStepPlanRevisionPrompt(
	round: number,
	summary: string,
	findings: readonly StepPlanReviewFinding[],
): string {
	return [
		`[!Klein step plan — REVISION requested by the plan reviewer (round ${round})]`,
		`Reviewer summary: ${summary.trim()}`,
		"",
		"Findings (address EVERY one; a finding naming a step means that step must change):",
		renderReviewFindings(findings),
		"",
		"Resubmit the COMPLETE corrected plan via submit_step_plan (all steps, not a diff). Keep ids of unchanged steps.",
	].join("\n");
}
