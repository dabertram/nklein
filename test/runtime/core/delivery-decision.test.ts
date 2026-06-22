import { describe, expect, it } from "vitest";

import { deliveryPolicyForTier } from "../../../src/core/agent-rulesets";
import { type DeliveryGateInputs, decideDeliveryAction } from "../../../src/core/delivery-decision";

const GREEN: DeliveryGateInputs = {
	reviewApproved: true,
	testsPassed: true,
	regressionDelta: 0,
	hasProtectedPathChanges: false,
};

describe("decideDeliveryAction", () => {
	it("keeps everything manual at the strict tier", () => {
		expect(decideDeliveryAction(deliveryPolicyForTier("strict"), GREEN)).toMatchObject({ action: "manual" });
	});

	it("auto-commits but does not PR/merge at less_strict", () => {
		expect(decideDeliveryAction(deliveryPolicyForTier("less_strict"), GREEN)).toMatchObject({ action: "commit" });
	});

	it("auto-opens a PR (human merges) at medium", () => {
		expect(decideDeliveryAction(deliveryPolicyForTier("medium"), GREEN)).toMatchObject({ action: "open_pr" });
	});

	it("auto-merges on green gates at more_open, without self-merge", () => {
		const decision = decideDeliveryAction(deliveryPolicyForTier("more_open"), GREEN);
		expect(decision.action).toBe("merge");
		expect(decision.selfMerge).toBe(false);
	});

	it("more_open will not self-merge on an unknown regression delta (falls back to PR)", () => {
		const decision = decideDeliveryAction(deliveryPolicyForTier("more_open"), { ...GREEN, regressionDelta: null });
		expect(decision.action).toBe("open_pr");
	});

	it("fully_open self-merges even with an unknown regression delta", () => {
		const decision = decideDeliveryAction(deliveryPolicyForTier("fully_open"), { ...GREEN, regressionDelta: null });
		expect(decision.action).toBe("merge");
		expect(decision.selfMerge).toBe(true);
	});

	it("never merges when review has not approved, regardless of tier (falls back)", () => {
		const decision = decideDeliveryAction(deliveryPolicyForTier("fully_open"), { ...GREEN, reviewApproved: false });
		expect(decision.action).toBe("open_pr");
		expect(decision.reason).toMatch(/review/i);
	});

	it("never merges on a regression or protected-path change (falls back to PR)", () => {
		expect(
			decideDeliveryAction(deliveryPolicyForTier("fully_open"), { ...GREEN, regressionDelta: -1 }),
		).toMatchObject({
			action: "open_pr",
		});
		expect(
			decideDeliveryAction(deliveryPolicyForTier("fully_open"), { ...GREEN, hasProtectedPathChanges: true }),
		).toMatchObject({ action: "open_pr" });
	});
});
