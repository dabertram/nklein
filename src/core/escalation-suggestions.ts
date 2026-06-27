// §5.AB Layer-2 user escalation — the "get through the wall" suggestions.
//
// Escalation order (user, 2026-06-27): Layer 1 is fully AUTOMATIC — exhaust the §5.AA approaches (tried + retried),
// then try every other available + loaded model best-fit-first, all with no user intervention. ONLY when that is
// exhausted (`isHardStuck`) does !Klein involve the user — and never as a silent dead end. It shows the §5.AG "what
// was tried" report PLUS this set of actionable suggestions, because **often a simple user decision is enough** to get
// through the wall. Making a more capable model available is only ONE option (and the heaviest), so it always comes
// last; the simple decisions lead. Pure + deterministic; the surface (§5.AG panel) renders these and resumes the agent
// with whatever the user provides.

/** A user action that might unblock a hard-stuck task. Ordered conceptually simplest → heaviest. */
export type EscalationSuggestionKind =
	| "clarify_ambiguity"
	| "provide_context"
	| "adjust_constraints"
	| "approve_blocked_action"
	| "fix_environment"
	| "rescope_or_split"
	| "provide_more_capable_model";

export interface EscalationSuggestion {
	kind: EscalationSuggestionKind;
	title: string;
	detail: string;
}

/**
 * Optional signals about WHY the task is stuck, used only to promote the most-likely fix to the front. None of these
 * change WHICH suggestions appear — the full set always shows — they only reorder so the user sees the probable
 * unblock first.
 */
export interface EscalationSuggestionContext {
	/** A clarifying question is already pending for this task (§5.S). */
	clarifyPending?: boolean;
	/** A host/unsafe action was denied and is awaiting acknowledgement (§5.M G3b / §5.L). */
	blockedActionPending?: boolean;
	/** An environment / setup / dependency blocker was detected (e.g. missing tool, sandbox issue, §5.A). */
	environmentBlocked?: boolean;
}

/** The canonical suggestion set, in default order (simplest user decision first; more-capable-model always last). */
const ESCALATION_SUGGESTIONS: readonly EscalationSuggestion[] = [
	{
		kind: "clarify_ambiguity",
		title: "Clarify the goal",
		detail:
			"Answer the open question or pick a direction — the agent may be stuck on an ambiguity only you can resolve.",
	},
	{
		kind: "provide_context",
		title: "Provide missing context",
		detail: "Supply the files, examples, links, or credentials the agent needs but cannot see.",
	},
	{
		kind: "adjust_constraints",
		title: "Adjust a constraint",
		detail: "Relax or change a guardrail, acceptance bar, or scope that is blocking progress.",
	},
	{
		kind: "approve_blocked_action",
		title: "Approve a blocked action",
		detail: "The agent was denied a host or unsafe action it needs — approve it if it is safe to proceed.",
	},
	{
		kind: "fix_environment",
		title: "Fix the environment",
		detail: "Resolve a setup, dependency, or tooling problem that is outside the agent's reach.",
	},
	{
		kind: "rescope_or_split",
		title: "Re-scope or split the task",
		detail: "Break the task into smaller steps or narrow it — the current card may be too large for one pass.",
	},
	{
		kind: "provide_more_capable_model",
		title: "Make a more capable model available",
		detail:
			"Load or enable a stronger model. You can also let it analyze what was tried and produce detailed rectification guidance for the agent — local-first; cloud only if you have lifted the cloud lockdown.",
	},
];

/** The context flag, if any, that should promote a specific suggestion to the front. */
const CONTEXT_PRIORITY: ReadonlyArray<{ kind: EscalationSuggestionKind; when: keyof EscalationSuggestionContext }> = [
	{ kind: "clarify_ambiguity", when: "clarifyPending" },
	{ kind: "approve_blocked_action", when: "blockedActionPending" },
	{ kind: "fix_environment", when: "environmentBlocked" },
];

/**
 * Build the ordered user-escalation suggestions. The full set always appears (the user might know a fix we can't
 * detect); context only promotes the most-likely unblock(s) to the front, in priority order, while `more capable
 * model` always stays last. Pure.
 */
export function buildEscalationSuggestions(context: EscalationSuggestionContext = {}): EscalationSuggestion[] {
	const promoted: EscalationSuggestionKind[] = [];
	for (const { kind, when } of CONTEXT_PRIORITY) {
		if (context[when]) {
			promoted.push(kind);
		}
	}
	const byKind = new Map(ESCALATION_SUGGESTIONS.map((suggestion) => [suggestion.kind, suggestion]));
	const ordered: EscalationSuggestion[] = [];
	const seen = new Set<EscalationSuggestionKind>();
	for (const kind of promoted) {
		const suggestion = byKind.get(kind);
		if (suggestion && !seen.has(kind)) {
			ordered.push(suggestion);
			seen.add(kind);
		}
	}
	for (const suggestion of ESCALATION_SUGGESTIONS) {
		if (!seen.has(suggestion.kind)) {
			ordered.push(suggestion);
			seen.add(suggestion.kind);
		}
	}
	return ordered;
}
