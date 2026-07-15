import { describe, expect, it } from "vitest";
import { buildSafeReasoningCapture } from "../../../src/core/reasoning-capture";

describe("buildSafeReasoningCapture (F2.23)", () => {
	it("fails closed: withholds verbatim reasoning that contains a potential secret", () => {
		// A classic AWS-style access key (AKIA + 16 chars) — matches the shared secret catalog.
		const capture = buildSafeReasoningCapture("I'll use the key AKIAIOSFODNN7EXAMPLE to reach S3.");
		expect(capture.redactedForSecret).toBe(true);
		expect(capture.truncated).toBe(false);
		expect(capture.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
		expect(capture.text).toContain("withheld");
	});

	it("keeps secret-free reasoning verbatim (trimmed), untouched when within the cap", () => {
		const capture = buildSafeReasoningCapture("   first check the failing test, then narrow the diff   ");
		expect(capture).toEqual({
			text: "first check the failing test, then narrow the diff",
			redactedForSecret: false,
			truncated: false,
		});
	});

	it("bounds long secret-free reasoning to maxChars with an ellipsis", () => {
		const capture = buildSafeReasoningCapture("x".repeat(50), { maxChars: 10 });
		expect(capture.redactedForSecret).toBe(false);
		expect(capture.truncated).toBe(true);
		expect(capture.text).toBe(`${"x".repeat(10)}…`);
	});

	it("defaults maxChars sensibly and does not truncate short input", () => {
		const capture = buildSafeReasoningCapture("short thought");
		expect(capture.truncated).toBe(false);
		expect(capture.text).toBe("short thought");
	});
});
