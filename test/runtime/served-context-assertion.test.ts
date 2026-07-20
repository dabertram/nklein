import { describe, expect, it } from "vitest";
import { assessServedContext } from "../../src/core/served-context-assertion";

/**
 * P21.3 — the served-context assertion. The load-bearing behaviour is the SAFETY DEFAULT: an unprobed endpoint is
 * NOT routable, because the failure it guards is silent (a routed model that discards half its prompt errors
 * nowhere). The tests pin that unverified and silently-truncated both refuse routing, and that neither ever
 * offers the advertised length as safe.
 */

describe("assessServedContext", () => {
	it("UNPROBED is unverified and NOT routable — the safety default", () => {
		const a = assessServedContext({ advertisedContextTokens: 32000, probedServedContextTokens: null });
		expect(a.verdict).toBe("unverified");
		expect(a.routable).toBe(false);
		expect(a.safeContextTokens).toBe(0); // never the advertised guess
	});

	it("detects the Ollama-2k-default silent truncation", () => {
		const a = assessServedContext({ advertisedContextTokens: 32000, probedServedContextTokens: 2048 });
		expect(a.verdict).toBe("silently_truncated");
		expect(a.routable).toBe(false);
		// The served value IS usable; the advertised one is not.
		expect(a.safeContextTokens).toBe(2048);
		expect(a.reason).toContain("never at 32000");
	});

	it("VERIFIES when the probe meets the advertised window within tolerance", () => {
		const a = assessServedContext({ advertisedContextTokens: 32000, probedServedContextTokens: 30000 });
		expect(a.verdict).toBe("verified");
		expect(a.routable).toBe(true);
		expect(a.safeContextTokens).toBe(30000);
	});

	it("tolerates being just under advertised (template/BOS slack) but not materially under", () => {
		// 10% default floor = 28800. 29000 verifies; 28000 does not.
		expect(assessServedContext({ advertisedContextTokens: 32000, probedServedContextTokens: 29000 }).verdict).toBe(
			"verified",
		);
		expect(assessServedContext({ advertisedContextTokens: 32000, probedServedContextTokens: 28000 }).verdict).toBe(
			"silently_truncated",
		);
	});

	it("counts serving MORE than advertised as verified — the shortfall is the only lie", () => {
		expect(assessServedContext({ advertisedContextTokens: 8000, probedServedContextTokens: 16000 }).routable).toBe(
			true,
		);
	});

	it("NO verdict except verified is routable — the gate cannot be bypassed", () => {
		for (const probed of [null, 100, 2048]) {
			const a = assessServedContext({ advertisedContextTokens: 32000, probedServedContextTokens: probed });
			if (a.verdict !== "verified") {
				expect(a.routable).toBe(false);
			}
		}
	});
});
