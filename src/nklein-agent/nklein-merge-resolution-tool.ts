import { z } from "zod";
import type { AgentTool } from "./sdk-agent-types";

/**
 * `submit_merge_resolution` — the merge agent's structured output for the §5.AK Phase B conflict-resolution
 * session, mirroring how `submit_review` / `submit_plan_critique` are the reviewer's/critic's structured
 * outputs. A `::merge` synthetic session sits inside a SANDBOX reproduction of a result-branch merge conflict
 * (the host repo never holds the agent's dirty merge state) and calls this tool exactly once: `resolved`
 * (every conflict marker has already been edited away in the sandbox working tree — the runtime captures the
 * resolved files from there) or `cannot_resolve` with the concrete blocker, so the caller falls back to
 * today's abort-and-surface.
 *
 * Boundary rules learned the hard way (#15): the JSON schema tolerates explicit nulls exactly like the Zod
 * schema, and the Zod layer recovers rather than rejects — a rejected resolution call would loop the agent
 * into the mistake guard and waste the whole bounded session.
 */

export const nkleinMergeResolutionSubmissionSchema = z
	.object({
		outcome: z.enum(["resolved", "cannot_resolve"]),
		/** A short resolution summary: what conflicted, and how each side's intent was honored. */
		summary: z.string().min(1),
		/** The concrete blocker; required (non-empty) when the conflict cannot be resolved. */
		reason: z.string().nullable().optional(),
	})
	.refine((value) => value.outcome === "resolved" || Boolean(value.reason?.trim()), {
		message: "reason is required when outcome is cannot_resolve",
		path: ["reason"],
	});

export type NKleinMergeResolutionSubmission = z.infer<typeof nkleinMergeResolutionSubmissionSchema>;

export interface NKleinMergeResolutionResult {
	outcome: "resolved" | "cannot_resolve";
	summary: string;
	reason: string | null;
}

export type NKleinMergeResolutionSubmittedHandler = (result: NKleinMergeResolutionResult) => void | Promise<void>;

export function createNKleinMergeResolutionTool(options: {
	onSubmitted?: NKleinMergeResolutionSubmittedHandler;
}): AgentTool {
	return {
		name: "submit_merge_resolution",
		description:
			"Submit the outcome of this merge-conflict resolution. Call this exactly once, AFTER editing every conflicted file: outcome `resolved` when no conflict markers remain in the working tree, or `cannot_resolve` with the concrete blocker. Do not answer in prose; the resolution is delivered by this tool call.",
		inputSchema: {
			type: "object",
			properties: {
				outcome: {
					type: "string",
					enum: ["resolved", "cannot_resolve"],
					description:
						"`resolved` when every conflict marker has been edited away, or `cannot_resolve` to fall back to a surfaced conflict.",
				},
				summary: {
					type: "string",
					description: "A short summary of what conflicted and how you resolved (or why you could not).",
				},
				reason: {
					// Explicit nulls tolerated like the Zod schema (see #15 — a string-only schema rejected
					// approving reviewers pre-execution and burned the whole session).
					type: ["string", "null"],
					description: "The concrete blocker. Required when outcome is `cannot_resolve`.",
				},
			},
			required: ["outcome", "summary"],
			additionalProperties: false,
		},
		async execute(input) {
			const parsed = nkleinMergeResolutionSubmissionSchema.parse(input);
			const result: NKleinMergeResolutionResult = {
				outcome: parsed.outcome,
				summary: parsed.summary.trim(),
				reason: parsed.reason?.trim() || null,
			};
			await options.onSubmitted?.(result);
			return {
				ok: true,
				outcome: result.outcome,
				instruction:
					result.outcome === "resolved"
						? "Resolution submitted. Stop now; do not make further tool calls — !Klein captures the resolved files from your working tree."
						: "Resolution submitted: cannot resolve. Stop now; !Klein will abort the merge and surface the conflict.",
			};
		},
	};
}

/** The merge session's seed prompt: the conflict facts + the one-tool-call contract. */
export function buildMergeResolutionSeedPrompt(input: { taskId: string; conflictedPaths: readonly string[] }): string {
	const pathLines = input.conflictedPaths.map((path) => `- ${path}`).join("\n");
	return [
		`You are a merge-resolution agent. The delivered result branch of card "${input.taskId}" conflicts with the project's main tree, and your working tree has been left mid-merge with conflict markers (<<<<<<< / ======= / >>>>>>>) in place.`,
		`Conflicted files:\n${pathLines}`,
		`The two sides of every conflict: OURS (the <<<<<<< side) is the project's main tree — work already merged from other cards. THEIRS (the >>>>>>> side) is this card's delivered result branch. Keep BOTH intents where possible; where the card's own declared scope is in conflict, prefer THEIRS (the card owns that change).`,
		`Resolve EVERY conflict marker by editing the conflicted files directly — remove all <<<<<<< / ======= / >>>>>>> lines and leave the merged content you intend to ship. Avoid writing outside the conflicted files: ONLY the conflicted files listed above are captured back — any other edit is discarded. If a quick sanity check is available (a type-check or a targeted test), run it.`,
		`Then call submit_merge_resolution EXACTLY ONCE: outcome "resolved" when no markers remain, or "cannot_resolve" with the concrete blocker. Do not answer in prose.`,
	].join("\n\n");
}
