// §5.S — the pure DATA layer for a "N unresolved clarifications" board-header badge (the badge component itself is
// separate UI). A plan's decomposition can raise clarifying QUESTIONS; each is `open` | `answered` | `assumed-default`
// (nklein-plan-artifacts). A question is UNRESOLVED only when it is still `open` AND carries neither a real answer nor
// a working assumption — an `open` question with a usable assumption is resolved-with-default (§5.B), and both
// `answered` and `assumed-default` are resolved. Pure + deterministic; no I/O, no clock.

import type { NKleinPlanQuestion } from "../nklein-agent/nklein-plan-artifacts";

/** True when a question still needs the operator: `open` with no answer AND no assumption (whitespace = absent). */
export function isUnresolvedClarification(question: NKleinPlanQuestion): boolean {
	return question.status === "open" && !question.answer?.trim() && !question.assumption?.trim();
}

/** How many of a plan's questions are still unresolved (the badge count). Empty/undefined ⇒ 0. */
export function countUnresolvedClarifications(questions: readonly NKleinPlanQuestion[] | undefined | null): number {
	return (questions ?? []).reduce((total, question) => total + (isUnresolvedClarification(question) ? 1 : 0), 0);
}
