import { z } from "zod";
import { type FocusChain, normalizeFocusChain, summarizeFocusChain } from "../core/focus-chain";
import type { AgentTool } from "./sdk-agent-types";

/**
 * `update_focus_chain` — an agent's self-directed task checklist tool (todo §5.N). The agent calls it once at
 * the start of a task to draft its plan, then again whenever it makes progress, **re-emitting the whole list**
 * with each step's current status (the most reliable shape for small models — no fragile incremental edits).
 * Mirrors how `decompose_project` / `submit_review` give a structured artifact instead of prose to parse.
 *
 * The handler persists the normalized chain (board card / chat session) so the UI can render a live todo list
 * and the runtime can re-anchor the model on its plan.
 */

/**
 * Common step-status spellings models emit that map cleanly onto the canonical enum. Same tolerance family as
 * the verdict tools' #15/#27 hardening: a semantically-obvious call must never die on schema strictness.
 */
const FOCUS_CHAIN_STATUS_SYNONYMS: Record<string, "pending" | "in_progress" | "done" | "skipped"> = {
	"in-progress": "in_progress",
	"in progress": "in_progress",
	inprogress: "in_progress",
	active: "in_progress",
	wip: "in_progress",
	complete: "done",
	completed: "done",
	finished: "done",
	todo: "pending",
	open: "pending",
	skip: "skipped",
};

/** Step-label keys models substitute for `text` in the wild (run31 live: gpt-oss-120b sent `name`). */
const FOCUS_CHAIN_TEXT_ALIAS_KEYS = ["name", "title", "step", "label"] as const;

export const nkleinFocusChainStepSchema = z.preprocess(
	(value) => {
		if (value === null || typeof value !== "object" || Array.isArray(value)) {
			return value;
		}
		const record = { ...(value as Record<string, unknown>) };
		if (typeof record.text !== "string" || record.text.trim().length === 0) {
			for (const aliasKey of FOCUS_CHAIN_TEXT_ALIAS_KEYS) {
				const alias = record[aliasKey];
				if (typeof alias === "string" && alias.trim().length > 0) {
					record.text = alias;
					break;
				}
			}
		}
		if (typeof record.status === "string") {
			const canonical = FOCUS_CHAIN_STATUS_SYNONYMS[record.status.trim().toLowerCase()];
			if (canonical) {
				record.status = canonical;
			}
		}
		return record;
	},
	z.object({
		text: z.string().min(1),
		status: z.enum(["pending", "in_progress", "done", "skipped"]).default("pending"),
	}),
);

export const nkleinFocusChainSubmissionSchema = z.object({
	steps: z.array(nkleinFocusChainStepSchema),
});

export type NKleinFocusChainSubmittedHandler = (chain: FocusChain) => void | Promise<void>;

export function createNKleinFocusChainTool(options: { onUpdated?: NKleinFocusChainSubmittedHandler }): AgentTool {
	return {
		name: "update_focus_chain",
		description:
			"Maintain your focus chain — your own ordered checklist of the steps to complete this task. Call this FIRST to draft your plan (a handful of concrete steps), then again as you progress, each time re-sending the FULL list with each step's status (`pending`, `in_progress`, `done`, or `skipped`). Keep exactly one step `in_progress`. This is for staying on-task and showing progress; it does not do the work.",
		// Deliberately LENIENT at the SDK pre-validation layer (the #15/#27 lesson, re-learned live in run31:
		// gpt-oss-120b sent `steps[].name` instead of `steps[].text`, the strict schema pre-rejected the call,
		// and the turn derailed into a text-only stop). The Zod layer normalizes aliases/synonyms; anything it
		// still can't read gets a corrective `ok:false` instruction the model can act on — never a hard reject.
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
								description: "This step's status: pending, in_progress, done, or skipped.",
							},
						},
						required: [],
						additionalProperties: true,
					},
				},
				name: { type: "string", description: "Ignored. Do not include." },
			},
			required: ["steps"],
			additionalProperties: false,
		},
		async execute(input) {
			const validation = nkleinFocusChainSubmissionSchema.safeParse(input);
			if (!validation.success) {
				return {
					ok: false,
					instruction:
						'Could not read `steps`. Send `steps` as an array of objects, each shaped { "text": "<short step>", "status": "pending" | "in_progress" | "done" | "skipped" }, re-sending the FULL list each call.',
				};
			}
			const parsed = validation.data;
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
