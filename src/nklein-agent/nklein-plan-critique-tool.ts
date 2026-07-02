import { z } from "zod";
import type { AgentTool } from "./sdk-agent-types";

/**
 * `submit_plan_critique` — the diverse critic's structured output for the W4.3 decompose-critique deliberation
 * (§5.AW), mirroring how `submit_review` is the reviewer's structured output. A critic-role agent reads a
 * HIGH-STAKES decomposition (spec + task graph + dependencies) BEFORE the cascade starts and calls this tool
 * exactly once: `proceed` (the plan is sound — a valued sign-off) or `revise` with concrete, actionable feedback
 * the architect can apply in ONE revision round (the feedback rides the existing decompose bounce machinery).
 *
 * Boundary rules learned the hard way (#15): the JSON schema tolerates explicit nulls exactly like the Zod
 * schema, and the Zod layer recovers rather than rejects — a rejected critique call would loop the critic into
 * the mistake guard and waste the whole deliberation.
 */

export const nkleinPlanCritiqueSubmissionSchema = z
	.object({
		verdict: z.enum(["proceed", "revise"]),
		/** A short critique summary: what was checked and the headline judgment. */
		summary: z.string().min(1),
		/** Concrete, actionable plan changes; required (non-empty) when requesting a revision. */
		feedback: z.string().nullable().optional(),
	})
	.refine((value) => value.verdict === "proceed" || Boolean(value.feedback?.trim()), {
		message: "feedback is required when verdict is revise",
		path: ["feedback"],
	});

export type NKleinPlanCritiqueSubmission = z.infer<typeof nkleinPlanCritiqueSubmissionSchema>;

export interface NKleinPlanCritiqueResult {
	verdict: "proceed" | "revise";
	summary: string;
	feedback: string | null;
}

export type NKleinPlanCritiqueSubmittedHandler = (result: NKleinPlanCritiqueResult) => void | Promise<void>;

export function createNKleinPlanCritiqueTool(options: { onSubmitted?: NKleinPlanCritiqueSubmittedHandler }): AgentTool {
	return {
		name: "submit_plan_critique",
		description:
			"Submit your critique of this decomposition plan. Call this exactly once with a verdict of `proceed` (the plan is sound — a valued sign-off) or `revise` with concrete, actionable feedback for one revision round. Do not answer in prose; the critique is delivered by this tool call.",
		inputSchema: {
			type: "object",
			properties: {
				// #27 (run29 live): models sometimes ECHO the tool name inside the arguments
				// ({"name":"submit_plan_critique",...}) — with additionalProperties:false that rejected an otherwise
				// perfect verdict pre-execution and looped the session to abandonment. Tolerated and ignored
				// (the Zod layer strips unknown keys).
				name: { type: ["string", "null"], description: "Ignored. Do not include." },
				verdict: {
					type: "string",
					enum: ["proceed", "revise"],
					description: "`proceed` to approve the plan, or `revise` to send concrete feedback to the architect.",
				},
				summary: {
					type: "string",
					description: "A short summary of what you checked and your headline judgment.",
				},
				feedback: {
					// Explicit nulls tolerated like the Zod schema (see #15 — a string-only schema rejected
					// approving reviewers pre-execution and burned the whole session).
					type: ["string", "null"],
					description: "Concrete, actionable plan changes. Required when verdict is `revise`.",
				},
			},
			required: ["verdict", "summary"],
			additionalProperties: false,
		},
		async execute(input) {
			const parsed = nkleinPlanCritiqueSubmissionSchema.parse(input);
			const result: NKleinPlanCritiqueResult = {
				verdict: parsed.verdict,
				summary: parsed.summary.trim(),
				feedback: parsed.feedback?.trim() || null,
			};
			await options.onSubmitted?.(result);
			return {
				ok: true,
				verdict: result.verdict,
				instruction:
					result.verdict === "proceed"
						? "Critique submitted: proceed. Stop now; do not make further tool calls."
						: "Critique submitted: revision requested. Stop now; !Klein will send your feedback to the architect.",
			};
		},
	};
}

/** What the decompose tool hands the critique executor — minimal, serializable plan facts. */
export interface NKleinPlanCritiqueRequest {
	slug: string;
	spec: string;
	tasks: ReadonlyArray<{ id: string; title: string; dependsOn: readonly string[] }>;
	qualityWarnings: readonly string[];
}

/**
 * Executes ONE diverse-critic round for a high-stakes plan (the service backs this with a real model session).
 * Null ⇒ proceed (no diverse critic / budget spent / session yielded no verdict) — a critique NEVER blocks.
 */
export type NKleinPlanCritiqueRequestHandler = (
	request: NKleinPlanCritiqueRequest,
) => Promise<NKleinPlanCritiqueResult | null>;

/** The critic session's seed prompt: the plan's facts + the one-tool-call contract. */
export function buildPlanCritiqueSeedPrompt(request: NKleinPlanCritiqueRequest): string {
	const taskLines = request.tasks
		.map(
			(task) =>
				`- ${task.id}: ${task.title}${task.dependsOn.length > 0 ? ` (depends on: ${task.dependsOn.join(", ")})` : ""}`,
		)
		.join("\n");
	const warningLines =
		request.qualityWarnings.length > 0
			? `\n\nStructural quality warnings already flagged:\n${request.qualityWarnings.map((warning) => `- ${warning}`).join("\n")}`
			: "";
	return [
		`You are a plan critic giving a second opinion on a project decomposition BEFORE work starts. You come from a different model family than the architect on purpose — challenge assumptions rather than agree.`,
		`Plan slug: ${request.slug}`,
		`Specification:\n${request.spec}`,
		`Task graph:\n${taskLines}${warningLines}`,
		`Judge: Does the task breakdown cover the specification? Are dependencies correct and minimal (no false coupling, no missing prerequisite)? Is any task too big for one focused work session? Is anything missing that the spec requires? You may inspect the repository with your tools to verify claims.`,
		`Then call submit_plan_critique EXACTLY ONCE: verdict "proceed" if the plan is sound (a valued sign-off), or "revise" with concrete, actionable feedback the architect can apply in one revision. Do not answer in prose.`,
	].join("\n\n");
}
