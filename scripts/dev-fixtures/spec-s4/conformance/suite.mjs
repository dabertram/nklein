/**
 * The conformance suite. This file is YOURS to write.
 *
 * Contract:
 *   - `RULES` lists the rule ids this suite checks. Every id must be declared in `spec/spec.json`.
 *   - `checkConformance(subject)` is handed an implementation's module namespace — `subject.quote`,
 *     `subject.validate` — and returns an array of `{ rule, ok, detail }`, with at least one entry per declared
 *     rule. `ok: false` means the subject violates that rule; `detail` says what was observed.
 *   - Throwing is allowed and counts as rejecting the subject.
 *   - Never import anything from `candidates/`. Comparing an implementation against the oracle is not a
 *     conformance suite; it is a diff.
 */
export const RULES = [];

export function checkConformance(subject) {
	void subject;
	return [];
}
