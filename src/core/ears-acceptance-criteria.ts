/**
 * F12.8 EARS-notation acceptance criteria + one-at-a-time clarification — PURE core.
 *
 * Kiro and Spec-Kit converge on two things that make a spec TESTABLE by a small model: acceptance criteria in
 * EARS ("WHEN <trigger> THE SYSTEM SHALL <behavior>"), and at most a handful of clarifying questions asked ONE
 * AT A TIME about what/why (problem, actions, out-of-scope, success) rather than how.
 *
 * EARS matters here because a criterion in that shape maps almost mechanically onto a check: the trigger is the
 * setup, the behaviour is the assertion. Prose criteria ("should be fast", "handle errors gracefully") cannot be
 * verified and quietly become whatever the model decides they mean.
 *
 * Pairs with F12.9's spec-lint (which finds the GAPS); this renders what a well-formed criterion looks like and
 * sequences the questions that close them. The initializer wire lands with F11.1.
 */

export type EarsPattern = "ubiquitous" | "event_driven" | "state_driven" | "unwanted_behavior" | "optional_feature";

export interface EarsCriterion {
	readonly pattern: EarsPattern;
	/** The rendered EARS sentence. */
	readonly text: string;
}

export interface EarsCriterionInput {
	/** What triggers the behaviour ("the user submits an empty form"); omit for an always-true requirement. */
	readonly trigger?: string | null;
	/** The precondition state ("while offline"); omit when not state-scoped. */
	readonly state?: string | null;
	/** The required behaviour ("reject the submission with a field-level error"). */
	readonly behavior: string;
	/** True when this describes handling an UNWANTED condition (error/abuse path). */
	readonly unwanted?: boolean;
	/** Feature gate ("where billing is enabled"); omit when unconditional. */
	readonly feature?: string | null;
}

function clean(text: string): string {
	return text.trim().replace(/\s+/g, " ").replace(/[.]+$/, "");
}

/**
 * Render one criterion in the EARS shape that matches its inputs. The pattern is DERIVED from which fields are
 * present rather than asked for, so a caller cannot mislabel a sentence.
 */
export function renderEarsCriterion(input: EarsCriterionInput): EarsCriterion {
	const behavior = clean(input.behavior);
	const trigger = input.trigger ? clean(input.trigger) : null;
	const state = input.state ? clean(input.state) : null;
	const feature = input.feature ? clean(input.feature) : null;

	if (feature) {
		return { pattern: "optional_feature", text: `WHERE ${feature}, THE SYSTEM SHALL ${behavior}.` };
	}
	if (input.unwanted === true && trigger) {
		return { pattern: "unwanted_behavior", text: `IF ${trigger}, THEN THE SYSTEM SHALL ${behavior}.` };
	}
	if (state && trigger) {
		return { pattern: "event_driven", text: `WHILE ${state}, WHEN ${trigger}, THE SYSTEM SHALL ${behavior}.` };
	}
	if (state) {
		return { pattern: "state_driven", text: `WHILE ${state}, THE SYSTEM SHALL ${behavior}.` };
	}
	if (trigger) {
		return { pattern: "event_driven", text: `WHEN ${trigger}, THE SYSTEM SHALL ${behavior}.` };
	}
	return { pattern: "ubiquitous", text: `THE SYSTEM SHALL ${behavior}.` };
}

/** The four gap classes worth asking about, in the order a spec becomes testable. */
export type ClarificationTopic = "problem" | "core_actions" | "out_of_scope" | "success_criteria";

export interface ClarificationQuestion {
	readonly topic: ClarificationTopic;
	readonly question: string;
}

const QUESTIONS: Readonly<Record<ClarificationTopic, string>> = {
	problem: "What problem does this solve, and for whom? (What goes wrong today without it?)",
	core_actions: "What are the core actions a user takes — the 2–3 things this must let them do?",
	out_of_scope: "What is explicitly NOT in scope for this change?",
	success_criteria: "What observable result proves this is done — a command, an output, a state you can check?",
};

export interface SelectClarificationsInput {
	/** Topics the spec ALREADY answers (from F12.9's lint or the caller's own read). */
	readonly answered: readonly ClarificationTopic[];
	/** Max questions to ask in total (default 5 — Kiro/Spec-Kit's ceiling). */
	readonly limit?: number;
}

/**
 * Select the clarifying questions still worth asking, in priority order, capped. Returns the FULL ordered list so
 * the caller can ask them ONE AT A TIME — the discipline that keeps a small model (and a human) from answering a
 * wall of questions with one vague paragraph.
 */
export function selectClarifications(input: SelectClarificationsInput): ClarificationQuestion[] {
	const answered = new Set(input.answered);
	const limit = Math.max(0, input.limit ?? 5);
	const order: ClarificationTopic[] = ["problem", "core_actions", "out_of_scope", "success_criteria"];
	return order
		.filter((topic) => !answered.has(topic))
		.slice(0, limit)
		.map((topic) => ({ topic, question: QUESTIONS[topic] }));
}

/** The single NEXT question to ask, or null when the spec answers everything. One at a time, by contract. */
export function nextClarification(input: SelectClarificationsInput): ClarificationQuestion | null {
	return selectClarifications(input)[0] ?? null;
}
