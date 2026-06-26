import type { AgentTool } from "@nklein/shared";
import { z } from "zod";
import { type FocusChain, normalizeFocusChain, summarizeFocusChain } from "../core/focus-chain";

/**
 * `update_focus_chain` — an agent's self-directed task checklist tool (todo §5.N). The agent calls it once at
 * the start of a task to draft its plan, then again whenever it makes progress, **re-emitting the whole list**
 * with each step's current status (the most reliable shape for small models — no fragile incremental edits).
 * Mirrors how `decompose_project` / `submit_review` give a structured artifact instead of prose to parse.
 *
 * The handler persists the normalized chain (board card / chat session) so the UI can render a live todo list
 * and the runtime can re-anchor the model on its plan.
 */

export const nkleinFocusChainStepSchema = z.object({
	text: z.string().min(1),
	status: z.enum(["pending", "in_progress", "done", "skipped"]).default("pending"),
});

export const nkleinFocusChainSubmissionSchema = z.object({
	steps: z.array(nkleinFocusChainStepSchema),
});

export type NKleinFocusChainSubmittedHandler = (chain: FocusChain) => void | Promise<void>;

export function createNKleinFocusChainTool(options: { onUpdated?: NKleinFocusChainSubmittedHandler }): AgentTool {
	return {
		name: "update_focus_chain",
		description:
			"Maintain your focus chain — your own ordered checklist of the steps to complete this task. Call this FIRST to draft your plan (a handful of concrete steps), then again as you progress, each time re-sending the FULL list with each step's status (`pending`, `in_progress`, `done`, or `skipped`). Keep exactly one step `in_progress`. This is for staying on-task and showing progress; it does not do the work.",
		inputSchema: {
			type: "object",
			properties: {
				steps: {
					type: "array",
					description: "The full, ordered checklist (re-sent in full each call).",
					items: {
						type: "object",
						properties: {
							text: { type: "string", description: "A short, concrete step." },
							status: {
								type: "string",
								enum: ["pending", "in_progress", "done", "skipped"],
								description: "This step's current status.",
							},
						},
						required: ["text", "status"],
						additionalProperties: false,
					},
				},
			},
			required: ["steps"],
			additionalProperties: false,
		},
		async execute(input) {
			const parsed = nkleinFocusChainSubmissionSchema.parse(input);
			const chain = normalizeFocusChain(parsed.steps);
			if (!chain) {
				return {
					ok: false,
					instruction: "Provide at least one non-empty step in `steps`.",
				};
			}
			await options.onUpdated?.(chain);
			const summary = summarizeFocusChain(chain);
			return {
				ok: true,
				total: summary.total,
				done: summary.done,
				instruction: summary.complete
					? "Focus chain recorded; all steps are done or skipped."
					: "Focus chain recorded. Continue with the in-progress step; call this again as you complete steps.",
			};
		},
	};
}
