import { describe, expect, it } from "vitest";
import {
	assertNKleinContextWindowPolicy,
	evaluateNKleinContextWindowPolicy,
	NKLEIN_MIN_CONTEXT_WINDOW_TOKENS,
} from "../../../src/nklein-sdk/nklein-context-window-policy";

describe("nklein context window policy", () => {
	it("requires at least 32k reported context tokens", () => {
		expect(NKLEIN_MIN_CONTEXT_WINDOW_TOKENS).toBe(32_000);

		expect(
			evaluateNKleinContextWindowPolicy({
				providerId: "ollama",
				modelId: "qwen",
				contextWindow: 32_000,
			}),
		).toMatchObject({ ok: true, contextWindow: 32_000 });
		expect(() =>
			assertNKleinContextWindowPolicy({
				providerId: "ollama",
				modelId: "qwen",
				contextWindow: 16_000,
			}),
		).toThrow("requires at least 32,000");
		expect(() =>
			assertNKleinContextWindowPolicy({
				providerId: "ollama",
				modelId: "qwen",
				contextWindow: null,
			}),
		).toThrow("does not report a context window");
	});
});
