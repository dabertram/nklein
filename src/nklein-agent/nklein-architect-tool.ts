/**
 * F12.62 architect-phase tool contract (sibling of the F11.2j explorer pattern).
 *
 * The ARCHITECT session solves the card in prose — reads/searches freely, mutates nothing — and hands back ONE
 * intent-level implementation brief the EDITOR phase applies mechanically. The hand-back is a TOOL CALL
 * (`submit_implementation_brief`), not prose parsing: the 2026-07-18 review-pipeline forensics proved lean
 * tool-based submission is the reliable structured channel for small local models, and the F12.62 pure core's
 * `extractImplementationBrief` stays as the prose FALLBACK when a model narrates instead of calling.
 */

import { z } from "zod";
import { buildArchitectPrompt } from "../core/architect-editor-split";
import type { AgentTool } from "./sdk-agent-types";

export const nkleinArchitectBriefSchema = z.object({
	/** The numbered intent-level edit list: file + where + what, precise enough to apply without re-deriving. */
	brief: z.string().min(20),
});

export type NKleinArchitectBriefSubmittedHandler = (brief: string) => void | Promise<void>;

/** Seed prompt for the `::architect` session — the pure core's prompt plus the tool-call submission contract. */
export function buildArchitectSeedPrompt(taskPrompt: string): string {
	return [
		buildArchitectPrompt({ taskPrompt }),
		"",
		"Deliver the brief by calling the submit_implementation_brief tool with the `brief` field — the brief is delivered ONLY by that tool call.",
	].join("\n");
}

export function createNKleinArchitectBriefTool(options: {
	onSubmitted?: NKleinArchitectBriefSubmittedHandler;
}): AgentTool {
	return {
		name: "submit_implementation_brief",
		description:
			"Submit your implementation brief. Call this exactly once with `brief`: a numbered list of intent-level edits (file path, where in the file, what to change) precise enough for a mechanical editor to apply without re-deriving your reasoning. No diffs, no full file bodies.",
		inputSchema: {
			type: "object",
			properties: {
				// Models sometimes echo the tool name inside the arguments — tolerated and ignored (Zod strips it).
				name: { type: ["string", "null"], description: "Ignored. Do not include." },
				brief: {
					type: "string",
					description: "Numbered intent-level edits: file path + location anchor + what changes.",
				},
			},
			required: ["brief"],
		},
		async execute(input) {
			const parsed = nkleinArchitectBriefSchema.safeParse(input);
			if (!parsed.success) {
				return {
					error: "Could not read the brief. Call submit_implementation_brief with a non-empty `brief` (a numbered list of intent-level edits).",
				};
			}
			await options.onSubmitted?.(parsed.data.brief);
			return { ok: true, message: "Brief recorded. You are done — do not continue." };
		},
	};
}
