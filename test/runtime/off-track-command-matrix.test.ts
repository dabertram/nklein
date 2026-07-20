import { describe, expect, it } from "vitest";
import { COMPACTION_UTILISATION, decideOffTrackRemedy } from "../../src/core/off-track-intervention";

/**
 * P18.4 wire — the property the `dev off-track --matrix` view exists to make visible: a derailed card at high
 * context must NEVER be compacted, because compaction launders the drift into a shorter, more authoritative
 * record of the wrong decision. A full window and a derailed card share the symptom and demand opposite remedies.
 */

describe("off-track decision matrix", () => {
	it("an OFF-track card at high context restarts or parks — never compacts", () => {
		for (const captured of [false, true]) {
			const remedy = decideOffTrackRemedy({
				onTrack: false,
				contextUtilisation: 0.95,
				restartsSoFar: 0,
				hasCapturedWork: captured,
			}).remedy;
			expect(remedy).not.toBe("compact_and_continue");
			expect(["restart_with_restatement", "park"]).toContain(remedy);
		}
	});

	it("an ON-track card at the same high context DOES compact — the opposite remedy for the same symptom", () => {
		expect(
			decideOffTrackRemedy({
				onTrack: true,
				contextUtilisation: COMPACTION_UTILISATION + 0.1,
				restartsSoFar: 0,
				hasCapturedWork: false,
			}).remedy,
		).toBe("compact_and_continue");
	});

	it("captured work routes an off-track card to PARK, not restart — a human can salvage a half-right diff", () => {
		expect(
			decideOffTrackRemedy({ onTrack: false, contextUtilisation: 0.5, restartsSoFar: 0, hasCapturedWork: true })
				.remedy,
		).toBe("park");
	});
});
