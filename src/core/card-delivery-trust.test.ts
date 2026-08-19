import { describe, expect, it } from "vitest";
import type { RuntimeBoardCard } from "./api-contract";
import { runtimeBoardDataSchema } from "./board-api-contract";
import { resolveCardDeliveryTrust } from "./card-delivery-trust";

const plan: RuntimeBoardCard["generatedFromPlan"] = {
	artifactKind: "decomposition",
	planSlug: "some-plan",
	planTaskId: "plan-task-1",
	sourceTaskId: null,
};

describe("resolveCardDeliveryTrust", () => {
	it("trusts an operator-authored card — the case the old generatedFromPlan proxy held forever", () => {
		expect(resolveCardDeliveryTrust({ trustedOrigin: "operator" })).toEqual({
			trusted: true,
			reason: "operator_authored",
		});
	});

	it("trusts plan-generated cards, by stamp or by the legacy generatedFromPlan signal", () => {
		expect(resolveCardDeliveryTrust({ trustedOrigin: "plan" })).toMatchObject({ trusted: true });
		expect(resolveCardDeliveryTrust({ generatedFromPlan: plan })).toEqual({
			trusted: true,
			reason: "plan_generated",
		});
	});

	it("never trusts external ingress — not even when a plan was derived from that same untrusted text", () => {
		expect(resolveCardDeliveryTrust({ trustedOrigin: "external" })).toEqual({
			trusted: false,
			reason: "external_ingress",
		});
		// The explicit external stamp OUTRANKS a generatedFromPlan that grew out of it: a plan the ingress
		// text produced cannot launder that text's own provenance.
		expect(resolveCardDeliveryTrust({ trustedOrigin: "external", generatedFromPlan: plan })).toMatchObject({
			trusted: false,
			reason: "external_ingress",
		});
	});

	it("fails closed on an unstamped or missing card — byte-identical to the pre-change behavior", () => {
		expect(resolveCardDeliveryTrust({})).toEqual({ trusted: false, reason: "unstamped_origin" });
		expect(resolveCardDeliveryTrust(null)).toEqual({ trusted: false, reason: "unstamped_origin" });
		expect(resolveCardDeliveryTrust(undefined)).toEqual({ trusted: false, reason: "unstamped_origin" });
	});

	it("survives a board schema round-trip (the stamp is worthless if persistence strips it)", () => {
		// Same class as the M1 `board.streams` bug: written, then silently erased on the next read.
		const board = {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						{
							id: "c1",
							title: "Operator card",
							prompt: "do the thing",
							startInPlanMode: false,
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
							trustedOrigin: "operator",
						},
					],
				},
			],
			dependencies: [],
		};
		const parsed = runtimeBoardDataSchema.parse(board);
		const card = parsed.columns[0]?.cards[0];
		expect(card?.trustedOrigin).toBe("operator");
		expect(resolveCardDeliveryTrust(card).trusted).toBe(true);
	});
});
