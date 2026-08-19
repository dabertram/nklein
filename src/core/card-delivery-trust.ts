/**
 * Delivery trust origin (2026-08-19, found by the depth-volume campaign: 0/8 deliveries, both approves held).
 *
 * The delivery taint gate asks one question — *is this delivery grounded in operator-authored intent, or is it
 * being driven by content the agent merely READ?* — and answered it with `Boolean(card.generatedFromPlan)`.
 * That proxy is INVERTED at the trust boundary it guards:
 *
 *  - a decomposition card's prompt is MACHINE-authored (an architect model wrote it from an objective), and it
 *    passed;
 *  - a card the operator typed into the board themselves is the most directly human-authored input the product
 *    has, and it FAILED — permanently, because `repo_instruction` taint is attached the moment a worker reads a
 *    repo file, which is essentially every card (70 of 107 attempts across the campaign).
 *
 * So the gate did not distinguish trusted from untrusted work; it distinguished decomposed from undecomposed,
 * and held every hand-authored card in Review forever. This module names the real axis. It is deliberately a
 * closed, explicit set — a card whose provenance was never stamped (legacy boards, or any future creation path
 * that forgets) resolves to UNTRUSTED, which is byte-for-byte today's behavior: fail-closed, never a silent
 * widening.
 */

import type { RuntimeBoardCard } from "./api-contract";

/** Where a card's objective text came from — the trust axis the delivery gate actually needs. */
export const CARD_TRUSTED_ORIGINS = ["operator", "plan", "external"] as const;
export type CardTrustedOrigin = (typeof CARD_TRUSTED_ORIGINS)[number];

export type CardDeliveryTrust = {
	/** True ⇒ the delivery may proceed on operator-grounded intent despite ambient repo taint. */
	trusted: boolean;
	/** Why, for the audit line — never a bare boolean in the log. */
	reason: "operator_authored" | "plan_generated" | "external_ingress" | "unstamped_origin";
};

/**
 * Resolve whether a card's delivery is grounded in operator-authored intent.
 *
 * `external` is the case this exists to keep OUT: a card seeded by A2A/webhook ingress carries text a third
 * party wrote, so it must still re-ground in a fresh trusted plan before moving a protected sink — even though
 * it arrived through a first-party API.
 */
export function resolveCardDeliveryTrust(
	card: Pick<RuntimeBoardCard, "generatedFromPlan" | "trustedOrigin"> | null | undefined,
): CardDeliveryTrust {
	const origin = card?.trustedOrigin;
	if (origin === "external") {
		// Explicitly untrusted: never rescued by a plan the same untrusted text produced.
		return { trusted: false, reason: "external_ingress" };
	}
	if (origin === "operator") {
		return { trusted: true, reason: "operator_authored" };
	}
	if (origin === "plan" || card?.generatedFromPlan) {
		return { trusted: true, reason: "plan_generated" };
	}
	return { trusted: false, reason: "unstamped_origin" };
}
