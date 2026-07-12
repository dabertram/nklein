import { describe, expect, it } from "vitest";
import { deliveryPolicyForTier } from "../../../src/core/agent-rulesets";
import { decideDeliveryAction } from "../../../src/core/delivery-decision";
import {
	deriveDeliveryGateEvidence,
	regressionDeltaFromAcceptanceRuns,
	regressionDeltaFromClassification,
	shouldHoldEmptyPatchResult,
} from "../../../src/core/delivery-evidence";
import { classifyTestRegression } from "../../../src/core/test-regression-verdict";

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

// §5.L — the pure adapter that turns a fresh classifyTestRegression result into the decideDeliveryAction
// `regressionDelta` gate input. Semantics must match delivery-decision.ts: `<0` blocks merge, `null` is unknown
// (self-merge only at the most-open tier), `>=0` permits. The cases below drive a REAL classification through the
// adapter and into the gate so the sign convention is verified end-to-end, not just in isolation.
describe("regressionDeltaFromClassification (§5.L delivery gate input)", () => {
	it("one new failure, nothing fixed → delta -1, which blocks a more_open merge down to a held commit", () => {
		const classification = classifyTestRegression({
			current: [{ id: "t1", passed: false }],
			baselineFailingIds: [],
		});
		expect(classification.verdict).toBe("regressed");
		const delta = regressionDeltaFromClassification(classification);
		expect(delta).toBe(-1);

		const decision = decideDeliveryAction(deliveryPolicyForTier("more_open"), {
			reviewApproved: true,
			testsPassed: true,
			regressionDelta: delta,
			hasProtectedPathChanges: false,
		});
		expect(decision.action).toBe("commit");
		expect(decision.selfMerge).toBe(false);
	});

	it("two baseline failures now passing → delta +2, which lets a more_open tier merge (not a self-merge)", () => {
		const classification = classifyTestRegression({
			current: [],
			baselineFailingIds: ["b1", "b2"],
		});
		expect(classification.newlyFixedIds).toEqual(["b1", "b2"]);
		const delta = regressionDeltaFromClassification(classification);
		expect(delta).toBe(2);

		const decision = decideDeliveryAction(deliveryPolicyForTier("more_open"), {
			reviewApproved: true,
			testsPassed: true,
			regressionDelta: delta,
			hasProtectedPathChanges: false,
		});
		expect(decision.action).toBe("merge");
		expect(decision.selfMerge).toBe(false);
	});

	it("a measured-clean run (baseline present, nothing changed) is a real 0 delta, NOT unknown", () => {
		const classification = classifyTestRegression({
			current: [{ id: "t1", passed: true }],
			baselineFailingIds: [],
		});
		expect(classification.verdict).toBe("clean");
		// 0 is a measurement (neutral), distinct from null (never measured) — the gate merges without self-merging.
		expect(regressionDeltaFromClassification(classification)).toBe(0);
	});

	it("no baseline classification at all → null (unknown), which only fully_open self-merges", () => {
		const delta = regressionDeltaFromClassification(null);
		expect(delta).toBeNull();
		expect(regressionDeltaFromClassification(undefined)).toBeNull();

		const fullyOpen = decideDeliveryAction(deliveryPolicyForTier("fully_open"), {
			reviewApproved: true,
			testsPassed: true,
			regressionDelta: delta,
			hasProtectedPathChanges: false,
		});
		expect(fullyOpen.action).toBe("merge");
		expect(fullyOpen.selfMerge).toBe(true);

		// The same unknown delta at the more_open tier cannot self-merge — it falls back to a PR.
		const moreOpen = decideDeliveryAction(deliveryPolicyForTier("more_open"), {
			reviewApproved: true,
			testsPassed: true,
			regressionDelta: delta,
			hasProtectedPathChanges: false,
		});
		expect(moreOpen.action).toBe("commit");
		expect(moreOpen.selfMerge).toBe(false);
	});
});

describe("regressionDeltaFromAcceptanceRuns (§5.L measured command-level delta)", () => {
	const ran = (passed: boolean) => ({ present: true, passed });

	it("delivered green ⇒ 0 (no regression at command granularity — un-deadens the more_open tier)", () => {
		expect(regressionDeltaFromAcceptanceRuns(ran(true), null)).toBe(0);
		expect(regressionDeltaFromAcceptanceRuns(ran(true), ran(false))).toBe(0);
	});

	it("delivered failed + baseline failed ⇒ 0 (the #39 pre-existing-breakage waiver case)", () => {
		expect(regressionDeltaFromAcceptanceRuns(ran(false), ran(false))).toBe(0);
	});

	it("delivered failed + baseline green ⇒ -1 (a measured regression vs base; blocks merge)", () => {
		expect(regressionDeltaFromAcceptanceRuns(ran(false), ran(true))).toBe(-1);
	});

	it("unmeasured stays null: no delivered run, or a failure with no baseline sample", () => {
		expect(regressionDeltaFromAcceptanceRuns(null, ran(true))).toBeNull();
		expect(regressionDeltaFromAcceptanceRuns({ present: false, passed: null }, ran(true))).toBeNull();
		expect(regressionDeltaFromAcceptanceRuns(ran(false), null)).toBeNull();
		expect(regressionDeltaFromAcceptanceRuns(ran(false), { present: false, passed: null })).toBeNull();
	});

	it("feeds the gate: a measured 0 lets the more_open tier auto-merge where null could not", () => {
		const gates = (regressionDelta: number | null) => ({
			reviewApproved: true,
			testsPassed: true,
			regressionDelta,
			hasProtectedPathChanges: false,
		});
		const moreOpen = deliveryPolicyForTier("more_open");
		expect(decideDeliveryAction(moreOpen, gates(null)).action).not.toBe("merge"); // unknown delta blocks
		expect(
			decideDeliveryAction(moreOpen, gates(regressionDeltaFromAcceptanceRuns({ present: true, passed: true }, null)))
				.action,
		).toBe("merge");
	});
});
