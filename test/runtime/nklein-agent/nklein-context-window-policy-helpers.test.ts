import { describe, expect, it } from "vitest";
import {
	formatNKleinContextWindowTokens,
	isNKleinContextWindowPolicyError,
	NKleinContextWindowPolicyError,
	normalizeNKleinContextWindow,
} from "../../../src/nklein-agent/nklein-context-window-policy";

describe("isNKleinContextWindowPolicyError (§5.V coverage)", () => {
	it("recognizes only the policy error type", () => {
		expect(isNKleinContextWindowPolicyError(new NKleinContextWindowPolicyError("below floor"))).toBe(true);
		expect(isNKleinContextWindowPolicyError(new Error("other"))).toBe(false);
		expect(isNKleinContextWindowPolicyError("not an error")).toBe(false);
		expect(isNKleinContextWindowPolicyError(null)).toBe(false);
	});
});

describe("normalizeNKleinContextWindow (§5.V coverage)", () => {
	it("truncates a positive number and rejects non-positive / non-finite / non-number", () => {
		expect(normalizeNKleinContextWindow(32000)).toBe(32000);
		expect(normalizeNKleinContextWindow(32000.9)).toBe(32000); // truncated, not rounded
		expect(normalizeNKleinContextWindow(0)).toBeNull();
		expect(normalizeNKleinContextWindow(-1)).toBeNull();
		expect(normalizeNKleinContextWindow(Number.NaN)).toBeNull();
		expect(normalizeNKleinContextWindow(Number.POSITIVE_INFINITY)).toBeNull();
		expect(normalizeNKleinContextWindow(null)).toBeNull();
		expect(normalizeNKleinContextWindow(undefined)).toBeNull();
	});
});

describe("formatNKleinContextWindowTokens (§5.V coverage)", () => {
	it("renders the value as its locale-grouped string", () => {
		// Behavior lock without hardcoding a locale: it delegates to Number#toLocaleString.
		expect(formatNKleinContextWindowTokens(32000)).toBe((32000).toLocaleString());
		expect(formatNKleinContextWindowTokens(1000000)).toBe((1000000).toLocaleString());
	});
});
