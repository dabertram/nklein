/**
 * §5.AK repair-controller semantics (pure) — when a node fails, decide WHICH repair action to take, as a priority
 * escalation ladder from the cheapest/most-local action to the last-resort global re-decompose. Keeps the controller's
 * "what do we do about this failure" policy in one testable place; the effectful execution of each action (re-running
 * the node, splitting it, editing the graph) lives at the call site.
 *
 * Ladder rationale (highest priority first): an unmet DEPENDENCY blocks everything, so wire it first; a change that
 * invalidated a DOWNSTREAM node must propagate before we touch this node again; a passing node that only needs a
 * RE-REVIEW isn't a real failure. Only then do we work the local failure: fix an ambiguous SPEC before retrying, SPLIT
 * a node too large to fix as one unit, RETRY while rounds remain, and — only when everything local is exhausted —
 * escalate to a GLOBAL re-decompose (expensive; throws away work). Pure + total + deterministic.
 */

export type RepairAction =
	| "retry_node"
	| "refine_spec"
	| "split_node"
	| "add_dependency"
	| "invalidate_downstream"
	| "re_review"
	| "global_re_decompose";

export interface RepairControllerInput {
	/** The node's validation did NOT fully pass (repro/regression/checks). */
	validationFailed: boolean;
	/** A required dependency's output is missing/unmet — the node cannot proceed without it. */
	unmetDependency: boolean;
	/** This node's change invalidated a downstream node's assumptions (they must be re-run/invalidated). */
	downstreamInvalidated: boolean;
	/** The node passed the gates but a re-review is required (policy / low confidence). */
	needsReReview: boolean;
	/** The failure looks like an ambiguous / underspecified SPEC (no candidate localized, clarification asked). */
	specAmbiguous: boolean;
	/** Every candidate failed AND the footprint is broad — better to SPLIT than keep retrying as one unit. */
	nodeTooLarge: boolean;
	/** Retries remain for this node (below the per-node retry cap). */
	retriesRemaining: boolean;
	/** Local refinement is exhausted (nothing local left to try) — the gate before a global re-decompose. */
	refinementExhausted: boolean;
}

export interface RepairDecision {
	action: RepairAction;
	reason: string;
}

/** Decide the repair action for a failed/blocked node (pure escalation ladder). */
export function decideRepairAction(input: RepairControllerInput): RepairDecision {
	// 1. A missing input blocks the node entirely — wire the dependency before anything else.
	if (input.unmetDependency) {
		return { action: "add_dependency", reason: "A required dependency's output is missing; wire it first." };
	}
	// 2. Propagate a change that broke downstream assumptions before re-touching this node.
	if (input.downstreamInvalidated) {
		return { action: "invalidate_downstream", reason: "This node's change invalidated downstream nodes." };
	}
	// 3. A passing node that only needs a re-review is not a real failure.
	if (!input.validationFailed && input.needsReReview) {
		return { action: "re_review", reason: "Node passed the gates but requires a re-review." };
	}
	// 4. Work the local failure, cheapest/most-targeted first.
	if (input.validationFailed) {
		if (input.specAmbiguous) {
			return { action: "refine_spec", reason: "Failure looks spec-driven; refine the spec before retrying." };
		}
		if (input.nodeTooLarge) {
			return { action: "split_node", reason: "Node too large to fix as one unit; split it." };
		}
		if (input.retriesRemaining && !input.refinementExhausted) {
			return { action: "retry_node", reason: "Retries remain; re-run the node." };
		}
		// 5. Everything local is exhausted — the expensive last resort.
		return { action: "global_re_decompose", reason: "Local repair exhausted; re-decompose globally (last resort)." };
	}
	// A re-review requested even outside a validation failure still runs.
	if (input.needsReReview) {
		return { action: "re_review", reason: "Re-review requested." };
	}
	// No failure signal — nothing to repair; a retry is the safe no-signal default.
	return { action: "retry_node", reason: "No specific failure signal; retry as the safe default." };
}
