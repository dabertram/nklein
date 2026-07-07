/**
 * Delivery-autonomy decision core (todo §5.L). The second, independent ruleset dial: how far a finished card
 * proceeds — commit → open PR → merge → self-merge — without a human, as a function of the role's resolved
 * delivery tier ({@link AgentDeliveryPolicy}) and the safety gates.
 *
 * The gate semantics intentionally match the shipped `evaluateTrustedAutoMerge` (green tests, no protected-path
 * changes, non-negative regression delta, and an unknown delta only permitted at the most open tier). Keeping
 * this pure makes "what does each tier do when review passes / regresses / touches protected paths" unit-testable
 * without a live runtime; the wiring that actually performs the commit/PR/merge consults this.
 */

import type { AgentDeliveryPolicy } from "./agent-rulesets";

export type DeliveryAction = "manual" | "commit" | "open_pr" | "merge";

export interface DeliveryGateInputs {
	/** The second-opinion reviewer approved the work. */
	reviewApproved: boolean;
	/** Acceptance/test gate passed. */
	testsPassed: boolean;
	/** Regression delta vs base: `<0` is a regression (blocks merge), `null` is unknown. */
	regressionDelta: number | null;
	/** The diff touches protected safety paths (always blocks auto-merge). */
	hasProtectedPathChanges: boolean;
}

export interface DeliveryDecision {
	action: DeliveryAction;
	/** True when the resulting merge proceeds with an unknown regression delta (most-open tier only). */
	selfMerge: boolean;
	reason: string;
}

/** Why an auto-merge cannot proceed under this policy + gates, or `null` when it may. */
function mergeBlockReason(policy: AgentDeliveryPolicy, gates: DeliveryGateInputs): string | null {
	if (!gates.reviewApproved) {
		return "review has not approved the work";
	}
	if (!gates.testsPassed) {
		return "the acceptance/test gate is not green";
	}
	if (gates.hasProtectedPathChanges) {
		return "the diff changes protected safety paths";
	}
	if (gates.regressionDelta !== null && gates.regressionDelta < 0) {
		return "the regression delta is negative";
	}
	if (gates.regressionDelta === null && !policy.allowSelfMergeOnUnknownDelta) {
		return "the regression delta is unknown and this tier does not allow self-merge on unknown delta";
	}
	return null;
}

export function decideDeliveryAction(policy: AgentDeliveryPolicy, gates: DeliveryGateInputs): DeliveryDecision {
	if (!policy.autoCommit) {
		return { action: "manual", selfMerge: false, reason: "Delivery tier keeps commit/PR/merge manual." };
	}

	if (policy.autoMerge) {
		const blockedReason = mergeBlockReason(policy, gates);
		if (blockedReason === null) {
			return {
				action: "merge",
				selfMerge: gates.regressionDelta === null,
				reason: "Delivery tier auto-merges and all gates passed.",
			};
		}
		// Merge is gated off — fall back to the most autonomous step the tier still allows.
		if (policy.autoOpenPr) {
			return { action: "open_pr", selfMerge: false, reason: `Opened a PR instead of merging: ${blockedReason}.` };
		}
		return { action: "commit", selfMerge: false, reason: `Committed to the task branch: ${blockedReason}.` };
	}

	if (policy.autoOpenPr) {
		return {
			action: "open_pr",
			selfMerge: false,
			reason: "Delivery tier auto-commits and opens a PR for human merge.",
		};
	}
	return { action: "commit", selfMerge: false, reason: "Delivery tier auto-commits to the task branch." };
}

/**
 * #28 re-drive gate (todo §5.U — lifted from `finalizeHeadlessAutoReviewTask` in runtime-server.ts). When a held card's
 * reviewer APPROVED the work but the fresh acceptance check FAILED, the worker never learns why the card is stuck — so
 * re-drive it ONCE with the failing output (mirrors the W4.2a empty-patch re-drive); a repeat failure leaves the hold
 * for the operator. Pure: the caller separately guards that an acceptance run exists (its output feeds the re-drive
 * prompt) and owns the attempt counter + the actual re-drive. `maxRedrives` defaults to 1 (re-drive at most once).
 */
export function shouldRedriveApprovedButAcceptanceFailed(input: {
	reviewApproved: boolean;
	testsPassed: boolean;
	priorRedriveAttempts: number;
	maxRedrives?: number;
}): boolean {
	return input.reviewApproved && !input.testsPassed && input.priorRedriveAttempts < (input.maxRedrives ?? 1);
}
