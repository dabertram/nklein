import { describe, expect, it } from "vitest";
import { deriveDeliveryGateEvidence, shouldHoldEmptyPatchResult } from "../../../src/core/delivery-evidence";

const acceptance = (over: Partial<{ present: boolean; passed: boolean | null; exitCode: number | null }> = {}) => ({
	present: true,
	passed: true,
	exitCode: 0,
	...over,
});

describe("deriveDeliveryGateEvidence (fail-closed W0.1)", () => {
	it("approves + passes only on a delivered review AND a fresh present-and-passed acceptance", () => {
		const evidence = deriveDeliveryGateEvidence({ reviewOutcomeType: "delivered", acceptance: acceptance() });
		expect(evidence).toEqual({ reviewApproved: true, testsPassed: true, testsDetail: null });
	});

	it("a skipped review (disabled / no verdict / card not found) is NOT approval — fail closed", () => {
		const evidence = deriveDeliveryGateEvidence({ reviewOutcomeType: "skipped", acceptance: acceptance() });
		expect(evidence.reviewApproved).toBe(false);
		expect(evidence.testsPassed).toBe(true); // acceptance evidence is independent
	});

	it("unavailable acceptance evidence (null) fails closed with an 'unavailable' detail", () => {
		const evidence = deriveDeliveryGateEvidence({ reviewOutcomeType: "delivered", acceptance: null });
		expect(evidence.testsPassed).toBe(false);
		expect(evidence.testsDetail).toBe("acceptance evidence unavailable");
	});

	it("a card with no acceptance command fails closed (no auto-delivery on a lone approval)", () => {
		const evidence = deriveDeliveryGateEvidence({
			reviewOutcomeType: "delivered",
			acceptance: acceptance({ present: false, passed: null, exitCode: null }),
		});
		expect(evidence.testsPassed).toBe(false);
		expect(evidence.testsDetail).toBe("no acceptance command on the card");
	});

	it("a failing acceptance run fails closed with the exit code in the detail", () => {
		const evidence = deriveDeliveryGateEvidence({
			reviewOutcomeType: "delivered",
			acceptance: acceptance({ passed: false, exitCode: 1 }),
		});
		expect(evidence.testsPassed).toBe(false);
		expect(evidence.testsDetail).toBe("acceptance failed (exit 1)");
	});

	it("a null passed (command ran but no verdict) is NOT a pass", () => {
		const evidence = deriveDeliveryGateEvidence({
			reviewOutcomeType: "delivered",
			acceptance: acceptance({ passed: null, exitCode: null }),
		});
		expect(evidence.testsPassed).toBe(false);
		expect(evidence.testsDetail).toBe("acceptance failed (exit ?)");
	});
});

describe("shouldHoldEmptyPatchResult", () => {
	it("holds an unreviewed empty patch (no sign-off releases a no-op card)", () => {
		expect(shouldHoldEmptyPatchResult({ sandboxResult: "empty_patch", reviewApproved: false })).toBe(true);
	});

	it("lets a reviewer-signed-off empty patch complete (explicit judgment on the empty diff)", () => {
		expect(shouldHoldEmptyPatchResult({ sandboxResult: "empty_patch", reviewApproved: true })).toBe(false);
	});

	it("does not hold non-empty results (the delivery gate governs those)", () => {
		expect(shouldHoldEmptyPatchResult({ sandboxResult: "captured", reviewApproved: false })).toBe(false);
	});
});
