import { describe, expect, it } from "vitest";
import {
	acceptancePresentAndFailed,
	shouldWaiveAcceptanceAsPreexisting,
} from "../../../src/server/acceptance-waiver-decision";

describe("acceptancePresentAndFailed", () => {
	it("is true only when a run actually ran AND failed", () => {
		expect(acceptancePresentAndFailed({ present: true, passed: false })).toBe(true);
	});

	it("is false for a passing run, an absent run, or no run at all", () => {
		expect(acceptancePresentAndFailed({ present: true, passed: true })).toBe(false);
		expect(acceptancePresentAndFailed({ present: false, passed: false })).toBe(false);
		expect(acceptancePresentAndFailed({ passed: false })).toBe(false); // present missing → not "ran"
		expect(acceptancePresentAndFailed(null)).toBe(false);
		expect(acceptancePresentAndFailed(undefined)).toBe(false);
	});
});

describe("shouldWaiveAcceptanceAsPreexisting", () => {
	const failed = { present: true, passed: false };
	const passed = { present: true, passed: true };

	it("WAIVES only when BOTH the delivered tree and the base tree fail identically", () => {
		expect(shouldWaiveAcceptanceAsPreexisting(failed, failed)).toBe(true);
	});

	it("does NOT waive when the delivered failure is absent at baseline (still the worker's to fix)", () => {
		expect(shouldWaiveAcceptanceAsPreexisting(failed, passed)).toBe(false);
		expect(shouldWaiveAcceptanceAsPreexisting(failed, { present: false, passed: false })).toBe(false);
		expect(shouldWaiveAcceptanceAsPreexisting(failed, null)).toBe(false);
	});

	it("does NOT waive when the delivered tree did not fail (nothing to waive)", () => {
		expect(shouldWaiveAcceptanceAsPreexisting(passed, failed)).toBe(false);
		expect(shouldWaiveAcceptanceAsPreexisting(null, failed)).toBe(false);
	});
});
