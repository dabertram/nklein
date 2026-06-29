import { describe, expect, it } from "vitest";
import { BASE_SYSTEM_PROMPT } from "../../../src/agent-core/agent-action-decider";
import { detectVolatilePrefixContent } from "../../../src/core/cache-aware-prompt-layout";

describe("BASE_SYSTEM_PROMPT cache-stability guard (§5.AQ-D)", () => {
	it("contains NO cache-defeating volatile content (it is the stable prefix every turn reuses)", () => {
		// The base system prompt is the byte-stable prefix local runtimes reuse the KV cache on; a timestamp / date /
		// UUID / session id leaking into it would force a full re-prefill every turn (the openclaw #19892 outage class).
		// This guard fails loudly if a future edit reintroduces volatile content here.
		const findings = detectVolatilePrefixContent(BASE_SYSTEM_PROMPT);
		expect(findings).toEqual([]);
	});
});
