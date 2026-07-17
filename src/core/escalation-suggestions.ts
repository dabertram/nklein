// §5.AB Layer-2 user escalation — the "get through the wall" suggestions.
//
// Escalation order (user, 2026-06-27): Layer 1 is fully AUTOMATIC — exhaust the §5.AA approaches (tried + retried),
// then try every other available + loaded model best-fit-first, all with no user intervention. ONLY when that is
// exhausted (`isHardStuck`) does !Klein involve the user — and never as a silent dead end. It shows the §5.AG "what
// was tried" report PLUS this set of actionable suggestions, because **often a simple user decision is enough** to get
// through the wall. Making a more capable model available is only ONE option (and the heaviest), so it always comes
// last; the simple decisions lead. Pure + deterministic; the surface (§5.AG panel) renders these and resumes the agent
// with whatever the user provides.

import { resolveLineage } from "./model-lineage";
import type { OperatorTaskSignals } from "./operator-task-state";

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
	/**
	 * The REAL model id that just failed the task (the worker/primary), when known. Used to steer the
	 * `provide_more_capable_model` suggestion toward a DIFFERENT base-family (§5.AB reasoning-diversity) — loading a
	 * stronger SAME-family model tends to hit the same blind spot (~60% correlated failures). Absent ⇒ a generic hint.
	 */
	stuckModelId?: string | null;
}

const MORE_CAPABLE_MODEL_BASE =
	"Load or enable a stronger model. You can also let it analyze what was tried and produce detailed rectification guidance for the agent — local-first; cloud only if you have lifted the cloud lockdown.";

/**
 * The `provide_more_capable_model` detail, steered toward an UNCORRELATED family: same-lineage models share blind spots,
 * so a different base-family is likelier to break through where the stuck one failed. Names the family to avoid when the
 * stuck model's lineage is known; otherwise a generic diversity hint.
 */
function moreCapableModelDetail(stuckModelId?: string | null): string {
	const lineage = stuckModelId ? resolveLineage(stuckModelId) : "unknown";
	const diversity =
		lineage !== "unknown"
			? `Prefer a DIFFERENT model family than ${lineage} — same-family models share blind spots (~60% correlated failures), so an uncorrelated base architecture is likelier to break through.`
			: "Prefer a DIFFERENT model family than the ones that just failed — same-family models share blind spots, so an uncorrelated family is likelier to break through.";
	return `${MORE_CAPABLE_MODEL_BASE} ${diversity}`;
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
		// Detail is filled in per-call by moreCapableModelDetail() so it can steer toward a diverse family; this default
		// is the generic (no stuck-lineage) form.
		detail: moreCapableModelDetail(),
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
	// Steer the more-capable-model suggestion toward a diverse family when we know which model just failed.
	if (context.stuckModelId) {
		byKind.set("provide_more_capable_model", {
			kind: "provide_more_capable_model",
			title: "Make a more capable model available",
			detail: moreCapableModelDetail(context.stuckModelId),
		});
	}
	const ordered: EscalationSuggestion[] = [];
	const seen = new Set<EscalationSuggestionKind>();
	for (const kind of promoted) {
		const suggestion = byKind.get(kind);
		if (suggestion && !seen.has(kind)) {
			ordered.push(suggestion);
			seen.add(kind);
		}
	}
	for (const { kind } of ESCALATION_SUGGESTIONS) {
		const suggestion = byKind.get(kind);
		if (suggestion && !seen.has(kind)) {
			ordered.push(suggestion);
			seen.add(kind);
		}
	}
	return ordered;
}

/**
 * Map the §5.AG operator signals for a task into the suggestion context, so the user-escalation surface leads with the
 * most-likely unblock: a pending clarifying question, a denied host/unsafe action, or a sandbox/setup blocker. Pure —
 * other signals don't map to a suggestion (the full set still always shows; this only reorders). Compose as
 * `buildEscalationSuggestions(buildEscalationSuggestionContext(signals))`.
 */
export function buildEscalationSuggestionContext(signals: OperatorTaskSignals): EscalationSuggestionContext {
	return {
		clarifyPending: signals.clarifyingQuestionPending,
		blockedActionPending: signals.awaitingHostActionAck,
		environmentBlocked: signals.blockedKind === "agent_sandbox_unavailable",
	};
}

/** F12.59: confidence that the recommended action is the actual unblock — derived from signal SPECIFICITY. */
export type EscalationConfidence = "high" | "medium" | "low";

export interface EscalationRecommendation {
	/** The ONE action to lead with — "send the recommendation, not the question". */
	recommended: EscalationSuggestion;
	confidence: EscalationConfidence;
	/** Why this action leads (names the signal; honest when the lead is a generic fallback). */
	rationale: string;
	/** The remaining options, still shown — the user may know a fix we can't detect. */
	alternatives: EscalationSuggestion[];
}

/**
 * F12.59 "never a blank question": collapse the ordered suggestion set into ONE recommended action + a confidence.
 * Confidence is signal specificity, never model self-report: a KNOWN pending decision (blocked action / clarify)
 * = high — we can see exactly what the agent waits on; an environment blocker = medium (the class is known, the
 * exact fix varies); no specific signal = low (the lead is the conventionally-likeliest unblock, honestly labeled
 * a guess).
 */
export function recommendEscalationAction(context: EscalationSuggestionContext = {}): EscalationRecommendation {
	const ordered = buildEscalationSuggestions(context);
	const recommended = ordered[0] as EscalationSuggestion;
	const alternatives = ordered.slice(1);
	if (context.blockedActionPending) {
		return {
			recommended,
			confidence: "high",
			rationale:
				"The agent is provably waiting on a denied/blocked action — approving or rejecting it IS the unblock.",
			alternatives,
		};
	}
	if (context.clarifyPending) {
		return {
			recommended,
			confidence: "high",
			rationale: "A clarifying question is already pending — answering it IS the unblock.",
			alternatives,
		};
	}
	if (context.environmentBlocked) {
		return {
			recommended,
			confidence: "medium",
			rationale: "A sandbox/setup blocker was detected — the blocker class is known, the exact fix varies.",
			alternatives,
		};
	}
	return {
		recommended,
		confidence: "low",
		rationale:
			"No specific blocker signal was detected — this lead is the statistically-likeliest unblock, not a diagnosis. The alternatives are equally worth a look.",
		alternatives,
	};
}
