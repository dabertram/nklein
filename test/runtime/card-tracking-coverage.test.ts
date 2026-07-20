import { describe, expect, it } from "vitest";
import { CARD_TRACKING_CONTRACT, verifyTrackingCoverage } from "../../src/core/card-tracking-coverage";

/**
 * N18 — the coverage contract must be checkable, and must FAIL when it stops being true.
 *
 * The command that consumes this self-contaminated on its first run: it read all of `src/`, which includes the
 * contract file, so every `emitterToken` matched its own declaration and a deliberately renamed token still
 * reported "verified against a real emitter". These tests pin the verifier's own behaviour, independent of which
 * text the command decides to search.
 */

const sourceContaining = (tokens: readonly string[]) => tokens.join("\n");
const allTokens = CARD_TRACKING_CONTRACT.map((entry) => entry.emitterToken).filter(
	(token): token is string => token !== null,
);

describe("verifyTrackingCoverage", () => {
	it("passes when every claimed emitter token is present", () => {
		const result = verifyTrackingCoverage({ sourceText: sourceContaining(allTokens) });
		expect(result.brokenClaims).toEqual([]);
		expect(result.ok).toBe(true);
	});

	it("FAILS and names the claim when an emitter disappears", () => {
		// The rot this exists to catch: a rename ships, the emitter is gone, and the table goes on promising
		// coverage that no longer exists — silently, because a trail's failure mode is silence.
		const withoutLaneChange = allTokens.filter((token) => token !== "card_lane_change");
		const result = verifyTrackingCoverage({ sourceText: sourceContaining(withoutLaneChange) });
		expect(result.ok).toBe(false);
		expect(result.brokenClaims.join(" ")).toContain("card_lane_change");
	});

	it("does not pass on an EMPTY source — the degenerate case that would make it useless", () => {
		expect(verifyTrackingCoverage({ sourceText: "" }).ok).toBe(false);
	});

	it("counts every entry exactly once across the three statuses", () => {
		const result = verifyTrackingCoverage({ sourceText: sourceContaining(allTokens) });
		const counted = result.totals.tracked + result.totals.partial + result.totals.untracked;
		expect(counted).toBe(CARD_TRACKING_CONTRACT.length);
	});

	it("requires a stated GAP on anything not fully tracked", () => {
		// A gap without words is not actionable, and an unexplained 'partial' decays into an accepted fact.
		for (const entry of CARD_TRACKING_CONTRACT) {
			if (entry.status !== "tracked") {
				expect(entry.gap, `${entry.id} must explain its gap`).toBeTruthy();
			}
		}
	});

	it("requires a checkable token on anything CLAIMED to be tracked", () => {
		// Without this, "tracked" with no token is exactly the unfalsifiable claim the contract exists to prevent.
		for (const entry of CARD_TRACKING_CONTRACT) {
			if (entry.status !== "untracked") {
				expect(entry.emitterToken, `${entry.id} claims coverage and must be checkable`).toBeTruthy();
			}
		}
	});

	it("keeps `untracked` entries tokenless, so nothing pretends to verify them", () => {
		for (const entry of CARD_TRACKING_CONTRACT) {
			if (entry.status === "untracked") {
				expect(entry.emitterToken).toBeNull();
			}
		}
	});
});
