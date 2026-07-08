/**
 * §5.AD cross-model bounce — the prompt substrate behind the enforced-reasoning gate's `cross_model_carry` kind:
 * a STRONGER loaded model critiques-and-repairs a weaker model's draft (the external signal Huang et al. show
 * self-correction lacks). Sibling of `self-bounce-personas.ts` (same-model varied lenses); here the lens is a
 * different, more capable model. Pure — the gate decides WHEN, the §5.K reviewer seam supplies the model call.
 *
 * The carry prompt asks for a REPAIRED deliverable, not just commentary: the whole point of the carry is that the
 * stronger model's output can REPLACE the weak draft when it improves on it (the caller diffs/validates).
 */

export interface CrossModelBouncePromptInput {
	/** The original task text (what the draft was supposed to accomplish). */
	task: string;
	/** The weaker model's draft under review. */
	draft: string;
	/** The drafting model's id — surfaced so the reviewer knows it is checking another model's work, not its own. */
	draftModelId?: string;
}

export interface CrossModelBouncePrompt {
	system: string;
	user: string;
}

export function buildCrossModelBouncePrompt(input: CrossModelBouncePromptInput): CrossModelBouncePrompt {
	const author = input.draftModelId?.trim() ? ` (drafted by ${input.draftModelId.trim()})` : "";
	return {
		system:
			"You are a senior engineer reviewing a draft produced by a smaller model. Verify it against the task, " +
			"fix every defect you find, and return the corrected deliverable IN FULL — not commentary about it. " +
			"If the draft is already correct, return it unchanged.",
		user: [
			`TASK:\n${input.task.trim()}`,
			`DRAFT${author}:\n${input.draft.trim()}`,
			"Return exactly two sections:",
			"FINDINGS: numbered defects (or 'none').",
			"REPAIRED: the full corrected deliverable.",
		].join("\n\n"),
	};
}

export interface CrossModelBounceOutcome {
	findings: string;
	/** The repaired deliverable, or null when the reply carried no REPAIRED section (keep the original draft). */
	repaired: string | null;
}

/** Parse the reviewer's reply; a missing REPAIRED section keeps the original draft (fail-soft, never lose work). */
export function parseCrossModelBounceReply(reply: string): CrossModelBounceOutcome {
	const findingsMatch = reply.match(/FINDINGS:\s*([\s\S]*?)(?=\nREPAIRED:|$)/i);
	const repairedMatch = reply.match(/REPAIRED:\s*([\s\S]+)$/i);
	const repaired = repairedMatch?.[1]?.trim() ?? null;
	return {
		findings: findingsMatch?.[1]?.trim() ?? "",
		repaired: repaired && repaired.length > 0 ? repaired : null,
	};
}
