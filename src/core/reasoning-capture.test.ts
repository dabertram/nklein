import { describe, expect, it } from "vitest";
import { findPotentialSecretInText } from "./agent-write-guard";
import { buildSafeReasoningCapture } from "./reasoning-capture";

// A reasoning trace that carries a token the shared secret catalog flags — derived from the detector so the test
// can never drift from the policy it guards.
const REASONING_WITH_SECRET =
	"I'll authenticate with export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789 next.";
const CLEAN_REASONING = "First I read the file, then I run the tests, then I summarize the result.";

describe("buildSafeReasoningCapture (F2.23 safe reasoning primitive)", () => {
	it("the secret sample really is flagged by the shared detector", () => {
		expect(findPotentialSecretInText(REASONING_WITH_SECRET)).not.toBeNull();
		expect(findPotentialSecretInText(CLEAN_REASONING)).toBeNull();
	});

	it("FAIL-CLOSED: reasoning with a potential secret is withheld for a placeholder (never persisted verbatim)", () => {
		const capture = buildSafeReasoningCapture(REASONING_WITH_SECRET);
		expect(capture.redactedForSecret).toBe(true);
		expect(capture.text).not.toContain("ghp_");
		expect(capture.text).toMatch(/withheld/i);
		expect(capture.truncated).toBe(false);
	});

	it("clean reasoning passes through trimmed and un-redacted", () => {
		const capture = buildSafeReasoningCapture(`  ${CLEAN_REASONING}  `);
		expect(capture).toEqual({ text: CLEAN_REASONING, redactedForSecret: false, truncated: false });
	});

	it("secret-free reasoning is bounded to maxChars with an ellipsis", () => {
		const long = "a".repeat(50);
		const capture = buildSafeReasoningCapture(long, { maxChars: 10 });
		expect(capture.truncated).toBe(true);
		expect(capture.redactedForSecret).toBe(false);
		expect(capture.text).toBe(`${"a".repeat(10)}…`);
	});
});
