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
