/**
 * F12.8 wire — compose the spec-lint (F12.9) and the EARS/clarification cores (F12.8) into the pipeline the
 * F11.1 guided initializer will run, so the cores stop being orphans while that surface is unbuilt. PURE.
 *
 * ── THE ONE HONEST INFERENCE, AND ITS LIMIT ──
 * The clarification sequencer needs to know which of its four topics a spec ALREADY answers. Only ONE of those is
 * detectable from the text: `success_criteria` is answered exactly when the lint finds no `missing_acceptance`
 * gap — the lint already decides whether a checkable success criterion is present, so reusing that judgement
 * keeps the two cores from disagreeing about the same fact.
 *
 * The other three — `problem`, `core_actions`, `out_of_scope` — **cannot be inferred from prose**, and this does
 * not pretend to. Guessing them from keyword presence would be the confident-nonsense heuristic this codebase has
 * been bitten by repeatedly; a spec that says the word "problem" has not necessarily stated its problem. So they
 * are reported as `undetermined` unless the caller marks them answered, and the output says so rather than
 * quietly treating undetermined as answered — which would drop a real question.
 */

import type { ClarificationQuestion, ClarificationTopic } from "./ears-acceptance-criteria";
import { nextClarification, selectClarifications } from "./ears-acceptance-criteria";
import type { SpecLintFinding } from "./spec-lint";
import { lintSpecForDecompose } from "./spec-lint";

export interface SpecReview {
	readonly lintFindings: readonly SpecLintFinding[];
	/** Topics the pipeline could DETECT as answered — currently only `success_criteria`, and only sometimes. */
	readonly detectedAnswered: readonly ClarificationTopic[];
	/** Topics whose answered-state cannot be read from text and were not asserted by the caller. */
	readonly undetermined: readonly ClarificationTopic[];
	/** Every still-open clarification in priority order — to be asked ONE at a time. */
	readonly openQuestions: readonly ClarificationQuestion[];
	/** The single next question, or null when nothing is open. */
	readonly next: ClarificationQuestion | null;
	readonly summary: string;
}

const AUTO_DETECTABLE: readonly ClarificationTopic[] = ["success_criteria"];

export function reviewSpec(input: {
	readonly spec: string;
	/** Topics the caller has independently confirmed the spec answers (e.g. a human read). */
	readonly callerAnswered?: readonly ClarificationTopic[];
	/** Topics an authoritative structured source confirms are absent, even if free-form text resembles an answer. */
	readonly callerUnanswered?: readonly ClarificationTopic[];
}): SpecReview {
	const lintFindings = lintSpecForDecompose(input.spec);
	const callerUnanswered = new Set(input.callerUnanswered ?? []);

	// `success_criteria` is answered iff the lint found no missing-acceptance gap — the SAME judgement, reused, so
	// the two cores cannot report contradictory things about whether the spec is checkable.
	const hasCheckableSuccess = !lintFindings.some((finding) => finding.kind === "missing_acceptance");
	const detectedAnswered =
		hasCheckableSuccess && !callerUnanswered.has("success_criteria")
			? (["success_criteria"] as ClarificationTopic[])
			: [];

	const callerAnswered = input.callerAnswered ?? [];
	const answered = [...new Set([...detectedAnswered, ...callerAnswered])].filter(
		(topic) => !callerUnanswered.has(topic),
	);

	// Undetermined = the topics this pipeline cannot read from text AND the caller did not assert. Reported, not
	// silently folded into "answered" — folding would drop a real question the initializer must still ask.
	const undetermined = AUTO_DETECTABLE.length
		? (["problem", "core_actions", "out_of_scope"] as ClarificationTopic[]).filter(
				(topic) => !answered.includes(topic),
			)
		: [];

	const openQuestions = selectClarifications({ answered });
	const next = nextClarification({ answered });

	return {
		lintFindings,
		detectedAnswered,
		undetermined,
		openQuestions,
		next,
		summary: [
			`${lintFindings.length} lint finding(s); ${openQuestions.length} clarification(s) still open.`,
			hasCheckableSuccess
				? "The spec has a checkable success criterion."
				: "No checkable success criterion — the lint flags this and success_criteria stays open.",
			undetermined.length > 0
				? `${undetermined.join(", ")} could NOT be detected from the text — pass --answered to mark any the caller has confirmed, or they stay open.`
				: "All structural topics accounted for.",
		].join(" "),
	};
}
