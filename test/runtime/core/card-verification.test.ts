import { describe, expect, it } from "vitest";
import { cardVerificationFromAcceptance } from "../../../src/core/delivery-evidence";

const AT = 1_800_000_000_000;

describe("cardVerificationFromAcceptance (F12.53)", () => {
	it("maps a passing run to a green snapshot with the command in the detail", () => {
		const snapshot = cardVerificationFromAcceptance(
			{ present: true, command: "npm test", passed: true, failureHint: null },
			AT,
		);
		expect(snapshot).toEqual({
			acceptancePresent: true,
			acceptancePassed: true,
			detail: "`npm test` passed.",
			checkedAt: AT,
		});
	});

	it("maps a failing run to red with the failure hint, never leaking raw output", () => {
		const snapshot = cardVerificationFromAcceptance(
			{ present: true, command: "npm test", passed: false, failureHint: "2 tests failed" },
			AT,
		);
		expect(snapshot.acceptancePassed).toBe(false);
		expect(snapshot.detail).toBe("`npm test` FAILED — 2 tests failed");
	});

	it("never fabricates a green: no command and could-not-run both read unverified", () => {
		expect(
			cardVerificationFromAcceptance({ present: false, command: null, passed: null, failureHint: null }, AT),
		).toEqual({
			acceptancePresent: false,
			acceptancePassed: null,
			detail: "No acceptance command defined.",
			checkedAt: AT,
		});
		expect(cardVerificationFromAcceptance(null, AT).acceptancePassed).toBeNull();
	});
});
