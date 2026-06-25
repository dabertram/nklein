import { describe, expect, it } from "vitest";
import {
	RUNTIME_NKLEIN_DEFAULT_CONTEXT_WINDOW_TOKENS,
	RUNTIME_NKLEIN_MIN_CONTEXT_WINDOW_TOKENS,
} from "../../../src/core/api-contract";
import {
	assertNKleinContextWindowPolicy,
	evaluateNKleinContextWindowPolicy,
	NKLEIN_MIN_CONTEXT_WINDOW_TOKENS,
} from "../../../src/nklein-sdk/nklein-context-window-policy";

describe("nklein context window policy", () => {
	it("contract MIN and DEFAULT constants have the expected values", () => {
		expect(RUNTIME_NKLEIN_MIN_CONTEXT_WINDOW_TOKENS).toBe(32_000);
		expect(RUNTIME_NKLEIN_DEFAULT_CONTEXT_WINDOW_TOKENS).toBe(80_000);
	});

	it("runtime policy helper MIN agrees with the contract constant", () => {
		expect(NKLEIN_MIN_CONTEXT_WINDOW_TOKENS).toBe(RUNTIME_NKLEIN_MIN_CONTEXT_WINDOW_TOKENS);
	});

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
