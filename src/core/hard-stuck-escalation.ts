// §5.AB one-call escalation gate — "is this agent hard-stuck, and if so, what should the USER decide first?"
//
// This is the compose step above two pure cores: it FUSES the progress verdict (agent-stuckness.ts) with the
// Layer-2 user-escalation suggestions (escalation-suggestions.ts) so a caller gets a single, honest answer instead
// of wiring the two together (and re-deriving the "only hard_stuck escalates" rule) at every call site. The whole
// point of the fusion is the GATE: suggestions are built ONLY when the verdict is `hard_stuck`. A `progressing` or
// `transient` agent is still on the AUTOMATIC recovery ladder (more approaches/retries, or other loaded models) and
// must NOT surface a user-escalation panel — doing so would pull the user into a wall that !Klein can still clear
// itself. So `transient` (format slips / recoverable) returns no suggestions exactly like `progressing` does.
//
// When it DOES escalate, the suggestions are CONTEXT-derived, not the generic default order: the operator signals
// (a pending clarification, a denied host action, a sandbox/setup blocker) promote the most-likely unblock to the
// front via `buildEscalationSuggestionContext` → `buildEscalationSuggestions`. The full suggestion set always shows
// (the user may know a fix we can't detect); context only reorders. Making a more capable model available always
// stays last — it is the heaviest option, and a simple user decision usually gets through the wall first.
//
// PRIME DIRECTIVE #1: pure + deterministic — no I/O, no clock, no randomness; two normalized signal sets in, a
// verdict + gated suggestions out. Composes ONLY by import; it adds no new policy, it just gates and orders.
import {
	type AgentStuckness,
	type AgentStucknessSignals,
	type AgentStucknessThresholds,
	classifyAgentStuckness,
} from "./agent-stuckness";
import {
	buildEscalationSuggestionContext,
	buildEscalationSuggestions,
	type EscalationSuggestion,
} from "./escalation-suggestions";
import type { OperatorTaskSignals } from "./operator-task-state";

export interface HardStuckEscalationInput {
	/**
	 * The attempt-stream signals for THIS stuck-point (outcomes / approaches / loop / retry budget / progress). Drive
	 * the `progressing` | `transient` | `hard_stuck` verdict — only `hard_stuck` opens the user-escalation gate.
	 */
	stucknessSignals: AgentStucknessSignals;
	/**
	 * The §5.AG operator signals for the task, used ONLY when the gate opens: they promote the most-likely unblock
	 * (pending clarification / denied host action / sandbox blocker) to the front of the suggestions. Read only on a
	 * `hard_stuck` verdict, so a caller that has no operator signals to hand can pass an all-safe-default object.
	 */
	operatorSignals: OperatorTaskSignals;
	/** Optional non-default stuckness thresholds (min failures / min approaches) forwarded to the classifier. */
	thresholds?: AgentStucknessThresholds;
}

export interface HardStuckEscalationResult {
	/** The full progress verdict, surfaced so a caller can distinguish `progressing` from `transient` if it cares. */
	stuckness: AgentStuckness;
	/** `true` exactly when `stuckness === "hard_stuck"` — the ONLY verdict that escalates to the user. */
	hardStuck: boolean;
	/**
	 * The ordered Layer-2 user-escalation suggestions when hard-stuck (context-promoted, more-capable-model last), or
	 * an EMPTY array otherwise — a `progressing` / `transient` agent stays on the automatic recovery ladder.
	 */
	suggestions: EscalationSuggestion[];
}

/**
 * Assess whether an agent is hard-stuck and, if so, build the ORDERED user-escalation suggestions in one call.
 *
 * The gate is the value here: it classifies the attempt stream, and ONLY on a `hard_stuck` verdict does it map the
 * operator signals into a suggestion context (`buildEscalationSuggestionContext`) and order the suggestions
 * (`buildEscalationSuggestions`) so the most-likely unblock leads. For `progressing` or `transient` it returns
 * `suggestions: []` — those agents are still recoverable automatically and must not pull the user into the loop.
 * Pure + deterministic: no I/O, no clock, no randomness; it composes the two cores and adds only the gate + wiring.
 */
export function assessHardStuckEscalation(input: HardStuckEscalationInput): HardStuckEscalationResult {
	const stuckness = classifyAgentStuckness(input.stucknessSignals, input.thresholds);
	const hardStuck = stuckness === "hard_stuck";
	// The gate: suggestions ONLY when hard-stuck. Context is read solely on this branch, so `progressing` / `transient`
	// never touches the operator signals — the empty array is the "stay on automatic recovery" answer.
	const suggestions = hardStuck
		? buildEscalationSuggestions(buildEscalationSuggestionContext(input.operatorSignals))
		: [];
	return { stuckness, hardStuck, suggestions };
}
