/**
 * F4.12 — reasoning-aware truncation CLASSIFICATION. Given a completion that stopped on a length limit, decide WHY it
 * truncated relative to the planned reasoning/answer split (from `planReasoningOutputBudget`): did the model's REASONING
 * consume the headroom and starve the answer, or did the ANSWER itself hit its cap, or was it the overall/provider
 * ceiling? This is the diagnostic F4.12 needs so chat/swarm/review can react correctly — a reasoning-starved answer
 * warrants a bigger reasoning reserve or a non-reasoning retry, whereas an answer-capped one warrants a larger answer
 * budget. A completion that stopped naturally (no length limit) is never "truncated".
 *
 * PURE + deterministic; no I/O.
 */

export type TruncationCause = "none" | "reasoning_starved_answer" | "answer_budget" | "total_ceiling";

export interface OutputTruncationInput {
	/** True when the completion stopped because it hit a token/length limit (not a natural end / stop sequence). */
	hitLengthLimit: boolean;
	/** Reasoning tokens the model actually produced. */
	reasoningTokens: number;
	/** Answer (non-reasoning) tokens the model actually produced. */
	answerTokens: number;
	/** The planned reasoning headroom (from planReasoningOutputBudget). */
	reasoningBudget: number;
	/** The planned answer headroom. */
	answerBudget: number;
}

export interface OutputTruncationVerdict {
	truncated: boolean;
	cause: TruncationCause;
	reason: string;
}

/** Fraction of a budget that counts as "consumed" (a model rarely lands exactly on the cap). */
const CONSUMED_FRACTION = 0.95;

export function classifyOutputTruncation(input: OutputTruncationInput): OutputTruncationVerdict {
	if (!input.hitLengthLimit) {
		return { truncated: false, cause: "none", reason: "completed naturally (no length limit)" };
	}
	const reasoningBudget = Math.max(0, input.reasoningBudget);
	const answerBudget = Math.max(0, input.answerBudget);
	const reasoningConsumed = reasoningBudget > 0 && input.reasoningTokens >= reasoningBudget * CONSUMED_FRACTION;
	const answerConsumed = answerBudget > 0 && input.answerTokens >= answerBudget * CONSUMED_FRACTION;

	// Reasoning ate its headroom while the answer never got near its own cap ⇒ reasoning starved the answer.
	if (reasoningConsumed && !answerConsumed) {
		return {
			truncated: true,
			cause: "reasoning_starved_answer",
			reason: `reasoning used ${input.reasoningTokens}/${reasoningBudget} but answer only ${input.answerTokens}/${answerBudget} — raise reasoning reserve or retry non-reasoning`,
		};
	}
	if (answerConsumed) {
		return {
			truncated: true,
			cause: "answer_budget",
			reason: `answer hit its budget (${input.answerTokens}/${answerBudget}) — raise the answer budget`,
		};
	}
	return {
		truncated: true,
		cause: "total_ceiling",
		reason: `length-limited below both budgets (reasoning ${input.reasoningTokens}/${reasoningBudget}, answer ${input.answerTokens}/${answerBudget}) — likely the provider/context ceiling`,
	};
}
