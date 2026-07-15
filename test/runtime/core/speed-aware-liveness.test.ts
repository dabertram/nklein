import { describe, expect, it } from "vitest";
import { deriveLivenessThresholds } from "../../../src/core/speed-aware-liveness";

const BASE = { idleAfterMs: 120_000, stalledAfterMs: 600_000, heartbeatLostAfterMs: 1_200_000 };

describe("deriveLivenessThresholds (F3.19)", () => {
	it("keeps the base when speed is unknown (null) — no false derivation", () => {
		expect(
			deriveLivenessThresholds({
				measuredTokensPerSec: null,
				expectedOutputTokens: 5000,
				powerMode: "normal",
				base: BASE,
			}),
		).toEqual(BASE);
	});

	it("keeps the base for a fast model on a small task (expected gen well under the floor)", () => {
		// 500 tokens ÷ 50 tok/s = 10s × 3 = 30s < 600s base ⇒ base stalled unchanged.
		const t = deriveLivenessThresholds({
			measuredTokensPerSec: 50,
			expectedOutputTokens: 500,
			powerMode: "normal",
			base: BASE,
		});
		expect(t.stalledAfterMs).toBe(600_000);
	});

	it("EXTENDS the stall budget for a slow model on a big task (the false-kill fix)", () => {
		// 5000 tokens ÷ 5 tok/s = 1000s × 3 = 3000s ⇒ well above the 600s base.
		const t = deriveLivenessThresholds({
			measuredTokensPerSec: 5,
			expectedOutputTokens: 5000,
			powerMode: "normal",
			base: BASE,
		});
		expect(t.stalledAfterMs).toBe(3_000_000);
	});

	it("scales every threshold up in low power (2×) and never below the base", () => {
		const t = deriveLivenessThresholds({
			measuredTokensPerSec: 50,
			expectedOutputTokens: 500,
			powerMode: "low",
			base: BASE,
		});
		expect(t.idleAfterMs).toBe(240_000);
		expect(t.stalledAfterMs).toBe(1_200_000); // base floor × 2
		expect(t.heartbeatLostAfterMs).toBe(2_400_000);
	});

	it("compounds speed-extension AND low-power scaling", () => {
		// stalled floor = max(600s, 1000s×3=3000s)=3000s, × low-power 2 = 6000s.
		const t = deriveLivenessThresholds({
			measuredTokensPerSec: 5,
			expectedOutputTokens: 5000,
			powerMode: "low",
			base: BASE,
		});
		expect(t.stalledAfterMs).toBe(6_000_000);
	});

	it("honors a custom safety factor and never shortens on high power", () => {
		const t = deriveLivenessThresholds({
			measuredTokensPerSec: 10,
			expectedOutputTokens: 2000,
			powerMode: "high",
			base: BASE,
			safetyFactor: 2,
		});
		// 2000/10=200s ×2 = 400s < 600s base ⇒ base; high power multiplier is 1 (never shorter).
		expect(t.stalledAfterMs).toBe(600_000);
		expect(t.idleAfterMs).toBe(120_000);
	});
});
