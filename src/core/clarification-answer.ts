// §5.S — the pure core that projects a USER's manual clarification answer back onto a plan-artifact question (the
// owed "persist the user's answers back through the question state"). This is the MANUAL counterpart to
// auto-clarify.ts's `applyAutoClarifyDecision`: where that projects an architect/reviewer AUTO decision, this
// projects what the operator picked in the §5.S clarifying dialog — selected option ids (single- or multi-choice)
// plus the free-text affordance. Pure/deterministic; no I/O, reuses the plan-artifact schema by import.

import type { NKleinPlanQuestion } from "../nklein-agent/nklein-plan-artifacts";

export interface ClarificationAnswerInput {
	/** The option ids the user selected (one for single-choice, several for multi-choice). Unknown ids are ignored. */
	selectedOptionIds?: readonly string[];
	/** Free text the user typed (the §5.S free-text affordance). Whitespace-only counts as empty. */
	freeText?: string | null;
}

/**
 * Project a user's manual clarification answer onto a plan-artifact question. The answer string is composed from the
 * selected options' labels — taken in the QUESTION's option order (not click order) so it reads stably — followed by
 * any free text, joined by `"; "`. On a real answer the status becomes `answered` and any prior assumption is cleared
 * (an explicit answer overrides a §5.B assumed default). An EMPTY submission (no known option selected AND no free
 * text) is not an answer: the question is returned unchanged so a stray "submit" never marks it resolved.
 */
export function applyClarificationAnswer(
	question: NKleinPlanQuestion,
	input: ClarificationAnswerInput,
): NKleinPlanQuestion {
	const selectedIds = new Set(input.selectedOptionIds ?? []);
	const selectedLabels = question.options.filter((option) => selectedIds.has(option.id)).map((option) => option.label);

	const freeText = input.freeText?.trim() ?? "";
	const parts = freeText.length > 0 ? [...selectedLabels, freeText] : selectedLabels;

	if (parts.length === 0) {
		return question;
	}
	return { ...question, status: "answered", answer: parts.join("; "), assumption: null };
}
