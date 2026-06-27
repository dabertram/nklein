import { describe, expect, it } from "vitest";
import { isContextOverflowError } from "../../../src/nklein-agent/nklein-context-overflow-compaction";

describe("isContextOverflowError", () => {
	it("recognizes the varied vendor phrasings of a context-overflow error", () => {
		const overflowMessages = [
			"prompt is too long: 250000 tokens > 200000 maximum",
			"This model's maximum context length is 8192 tokens",
			"input is too long for the model",
			"context length exceeded",
			"Input exceeds the context window",
			"too many tokens in the request",
			"requested input length 9000 exceeds the maximum input length",
			"input token count exceeds the maximum 128000 tokens allowed",
		];
		for (const message of overflowMessages) {
			expect(isContextOverflowError(new Error(message))).toBe(true);
		}
	});

	it("does NOT flag unrelated errors (a false negative would crash instead of compact)", () => {
		expect(isContextOverflowError(new Error("network timeout"))).toBe(false);
		expect(isContextOverflowError(new Error("ECONNREFUSED 127.0.0.1:1234"))).toBe(false);
		expect(isContextOverflowError(new Error("invalid api key"))).toBe(false);
	});

	it("returns false for non-Error values", () => {
		expect(isContextOverflowError("prompt is too long")).toBe(false);
		expect(isContextOverflowError(null)).toBe(false);
		expect(isContextOverflowError({ message: "context length exceeded" })).toBe(false);
	});
});
