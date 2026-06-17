import { describe, expect, it } from "vitest";
import {
	assertClineContextWindowPolicy,
	CLINE_MIN_CONTEXT_WINDOW_TOKENS,
	evaluateClineContextWindowPolicy,
} from "../../../src/cline-sdk/cline-context-window-policy";

describe("cline context window policy", () => {
	it("requires at least 32k reported context tokens", () => {
		expect(CLINE_MIN_CONTEXT_WINDOW_TOKENS).toBe(32_000);

		expect(
			evaluateClineContextWindowPolicy({
				providerId: "ollama",
				modelId: "qwen",
				contextWindow: 32_000,
			}),
		).toMatchObject({ ok: true, contextWindow: 32_000 });
		expect(() =>
			assertClineContextWindowPolicy({
				providerId: "ollama",
				modelId: "qwen",
				contextWindow: 16_000,
			}),
		).toThrow("requires at least 32,000");
		expect(() =>
			assertClineContextWindowPolicy({
				providerId: "ollama",
				modelId: "qwen",
				contextWindow: null,
			}),
		).toThrow("does not report a context window");
	});
});
