import { z } from "zod";
import type { ReviewVerdict } from "../core/review-loop";
import type { AgentTool } from "./sdk-agent-types";

/**
 * `submit_review` — the reviewer role's structured output, mirroring how `decompose_project` is the architect's
 * structured output. A reviewer-role agent reviews a completed worker card (objective + diff + acceptance
 * result) and calls this tool exactly once with its verdict, instead of writing prose we have to parse. A
 * small/local model emitting a single tool call is far more reliable than free-text we then classify.
 *
 * `approve` is a real, valued outcome — a second-perspective sign-off even when no changes are needed.
 * `request_changes` must carry concrete, actionable feedback so the worker can act on it.
 */

export const nkleinReviewSubmissionSchema = z
	.object({
		verdict: z.enum(["approve", "request_changes"]),
		/** A short second-opinion summary: what was checked and the headline judgment. */
		summary: z.string().min(1),
		/** Concrete, actionable change requests; required (non-empty) when requesting changes. */
		feedback: z.string().nullable().optional(),
		/** Optional positive observations / insight worth recording even on approval. */
		insight: z.string().nullable().optional(),
		/**
		 * §5.AW best-of-N arbitration: when the seed presented TWO candidate diffs (A = primary, B =
		 * speculative), the reviewer names the one to deliver. Absent/null on ordinary single-candidate
		 * reviews — and tolerated-but-meaningless there (delivery only consults it when a speculative
		 * result branch actually exists).
		 */
		preferred: z.enum(["primary", "speculative"]).nullable().optional(),
	})
	.refine((value) => value.verdict === "approve" || Boolean(value.feedback?.trim()), {
		message: "feedback is required when verdict is request_changes",
		path: ["feedback"],
	});

export type NKleinReviewSubmission = z.infer<typeof nkleinReviewSubmissionSchema>;

export interface NKleinReviewResult {
	verdict: ReviewVerdict;
	summary: string;
	feedback: string | null;
	insight: string | null;
	/** §5.AW: the candidate the reviewer picked in an A/B best-of-N review; null outside arbitration. */
	preferred: "primary" | "speculative" | null;
}

export type NKleinReviewSubmittedHandler = (result: NKleinReviewResult) => void | Promise<void>;

export function createNKleinReviewTool(options: { onSubmitted?: NKleinReviewSubmittedHandler }): AgentTool {
	return {
		name: "submit_review",
		description:
			"Submit your second-opinion review of this card's completed work. Call this exactly once with a verdict of `approve` (a valued sign-off even when no changes are needed) or `request_changes` with concrete, actionable feedback. Do not answer in prose; the review is delivered by this tool call.",
		inputSchema: {
			type: "object",
			properties: {
				// #27 (run29 live): models sometimes ECHO the tool name inside the arguments
				// ({"name":"submit_review",...}) — with additionalProperties:false that rejected an otherwise
				// perfect verdict pre-execution and looped the session to abandonment. Tolerated and ignored
				// (the Zod layer strips unknown keys).
				name: { type: "string", description: "Ignored. Do not include." },
				verdict: {
					type: "string",
					enum: ["approve", "request_changes"],
					description: "`approve` to sign off, or `request_changes` to send it back to the worker.",
				},
				summary: {
					type: "string",
					description: "A short summary of what you reviewed and your headline judgment.",
				},
				feedback: {
					// Models routinely emit `feedback: null` on approval (the field is described as required only
					// for request_changes). The Zod schema accepts null, but a string-only JSON schema made the SDK
					// reject the call BEFORE execution — the reviewer then looped the same rejected call until the
					// mistake guard abandoned the session, and the review counted as skipped (fail-closed hold).
					// Harness-found (W2.1 v2); tolerate null at the boundary like the Zod schema does.
					type: ["string", "null"],
					description: "Concrete, actionable change requests. Required when verdict is `request_changes`.",
				},
				insight: {
					type: ["string", "null"],
					description: "Optional positive observations or insight worth recording even on approval.",
				},
				preferred: {
					// §5.AW best-of-N: only meaningful when the review seed presented candidates A (primary) and
					// B (speculative). Null-tolerant like feedback/insight — models emit explicit nulls.
					type: ["string", "null"],
					enum: ["primary", "speculative", null],
					description:
						"ONLY when this review compares candidate A (primary) and candidate B (speculative): the candidate to deliver — `primary` for A, `speculative` for B. Omit on ordinary single-candidate reviews.",
				},
			},
			required: ["verdict", "summary"],
			additionalProperties: false,
		},
		async execute(input) {
			const parsed = nkleinReviewSubmissionSchema.parse(input);
			const result: NKleinReviewResult = {
				verdict: parsed.verdict,
				summary: parsed.summary.trim(),
				feedback: parsed.feedback?.trim() || null,
				insight: parsed.insight?.trim() || null,
				preferred: parsed.preferred ?? null,
			};
			await options.onSubmitted?.(result);
			return {
				ok: true,
				verdict: result.verdict,
				instruction:
					result.verdict === "approve"
						? "Review submitted: approved. Stop now; do not make further tool calls."
						: "Review submitted: changes requested. Stop now; !Klein will send your feedback to the worker.",
			};
		},
	};
}
