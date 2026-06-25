import {
	RUNTIME_NKLEIN_DEFAULT_CONTEXT_WINDOW_TOKENS,
	RUNTIME_NKLEIN_MIN_CONTEXT_WINDOW_TOKENS,
} from "@runtime-contract";
import { describe, expect, it } from "vitest";

import { NKLEIN_MIN_CONTEXT_WINDOW_TOKENS } from "@/runtime/nklein-context-window-policy";

describe("web-ui nklein context window policy", () => {
	it("web-ui policy helper MIN agrees with the contract constant", () => {
		expect(NKLEIN_MIN_CONTEXT_WINDOW_TOKENS).toBe(RUNTIME_NKLEIN_MIN_CONTEXT_WINDOW_TOKENS);
		expect(NKLEIN_MIN_CONTEXT_WINDOW_TOKENS).toBe(32_000);
	});

	it("contract DEFAULT constant has the expected value", () => {
		expect(RUNTIME_NKLEIN_DEFAULT_CONTEXT_WINDOW_TOKENS).toBe(80_000);
	});
});
