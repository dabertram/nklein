import { afterEach, describe, expect, it } from "vitest";
import { decideOffTrackRemedy, MAX_RESTATEMENT_RESTARTS } from "../../../src/core/off-track-intervention";
import {
	clearOffTrackRestartLedger,
	forgetOffTrackRestarts,
	getOffTrackRestartCount,
	recordOffTrackRestart,
} from "../../../src/core/off-track-restart-ledger";

/**
 * P18.4b — the counter that makes the off-track restart cap bind.
 *
 * The cap exists because P18.4 named unbounded restarting "a loop that discards work while looking like
 * progress". Until this counter existed, the live wire had only one value it could pass — `0` — which defeats
 * the cap on every call, so the cap was present in the code and absent in effect.
 *
 * The headline property is therefore not storage, it is SURVIVAL: the remedy's action IS restarting the card's
 * session, so a counter stored on the session would be destroyed by the very event it counts, read `0` forever,
 * and never bind. The last suite drives the real decider through a full budget to prove the cap actually stops
 * — pinning the counter against the thing it exists to feed, rather than against itself.
 */
afterEach(() => {
	clearOffTrackRestartLedger();
});

describe("counting", () => {
	it("reports 0 for a card this remedy has never restarted", () => {
		// `0` is the true answer here, not a stand-in for "unknown": no entry means no restart was performed.
		// (Contrast the baseline-probe registry, where absence and a result are genuinely different facts.)
		expect(getOffTrackRestartCount("card-1")).toBe(0);
	});

	it("counts each recorded restart", () => {
		expect(recordOffTrackRestart("card-1")).toBe(1);
		expect(recordOffTrackRestart("card-1")).toBe(2);
		expect(getOffTrackRestartCount("card-1")).toBe(2);
	});

	it("returns the NEW count from the recording call", () => {
		// One call, one truth. A caller that incremented and then separately read would be free to act on a number
		// it did not itself produce.
		expect(recordOffTrackRestart("card-1")).toBe(getOffTrackRestartCount("card-1"));
	});

	it("keeps cards independent — one card's budget is not spent by another's", () => {
		recordOffTrackRestart("card-1");
		recordOffTrackRestart("card-1");
		recordOffTrackRestart("card-2");

		expect(getOffTrackRestartCount("card-1")).toBe(2);
		expect(getOffTrackRestartCount("card-2")).toBe(1);
	});
});

describe("the count SURVIVES the restart it counts", () => {
	it("is keyed by card, so a fresh session for the same card sees the earlier restarts", () => {
		// THE probe, expressed the only way it can be at this layer: the count is addressed by task id and by
		// nothing session-scoped. Had it been stored on the session, the remedy's own restart would destroy it and
		// the next read would be `0` — the cap present in the code and absent in effect.
		recordOffTrackRestart("card-1");
		recordOffTrackRestart("card-1");

		// A new session for the same card is, from here, simply another read of the same key.
		expect(getOffTrackRestartCount("card-1")).toBe(2);
	});

	it("is not reset by reading it", () => {
		recordOffTrackRestart("card-1");
		getOffTrackRestartCount("card-1");

		expect(getOffTrackRestartCount("card-1")).toBe(1);
	});
});

describe("forgetting", () => {
	it("returns a card to a fresh budget — replay starts over", () => {
		recordOffTrackRestart("card-1");
		forgetOffTrackRestarts("card-1");

		expect(getOffTrackRestartCount("card-1")).toBe(0);
	});

	it("forgets only the card asked for", () => {
		recordOffTrackRestart("card-1");
		recordOffTrackRestart("card-2");
		forgetOffTrackRestarts("card-1");

		expect(getOffTrackRestartCount("card-1")).toBe(0);
		expect(getOffTrackRestartCount("card-2")).toBe(1);
	});

	it("is silent for a card that never restarted", () => {
		expect(() => forgetOffTrackRestarts("never-restarted")).not.toThrow();
	});
});

describe("the cap actually binds — driven through the real decider", () => {
	// Off track, nothing salvageable, and enough context pressure to reach the off-track branch at all.
	const offTrackWithNothingToSave = (taskId: string) => ({
		onTrack: false,
		hasCapturedWork: false,
		contextUtilisation: 0.95,
		restartsSoFar: getOffTrackRestartCount(taskId),
	});

	it("restarts while budget remains, then PARKS once it is spent", () => {
		// The whole point, end to end. Each iteration reads the ledger, asks the real decider, and records the
		// restart it was told to perform — the loop the live wire will run.
		const remedies: string[] = [];
		for (let attempt = 0; attempt <= MAX_RESTATEMENT_RESTARTS; attempt += 1) {
			const decision = decideOffTrackRemedy(offTrackWithNothingToSave("card-1"));
			remedies.push(decision.remedy);
			if (decision.remedy === "restart_with_restatement") {
				recordOffTrackRestart("card-1");
			}
		}

		expect(remedies.slice(0, MAX_RESTATEMENT_RESTARTS)).toEqual(
			Array.from({ length: MAX_RESTATEMENT_RESTARTS }, () => "restart_with_restatement"),
		);
		expect(remedies.at(-1)).toBe("park");
	});

	it("would NEVER park if the count stayed 0 — the defect this counter closes", () => {
		// The counterfactual, stated as a test so the regression is visible rather than argued. Passing the
		// hard-coded `0` the live wire has today, the decider restarts forever.
		const remedies = Array.from(
			{ length: MAX_RESTATEMENT_RESTARTS + 3 },
			() =>
				decideOffTrackRemedy({ onTrack: false, hasCapturedWork: false, contextUtilisation: 0.95, restartsSoFar: 0 })
					.remedy,
		);

		expect(new Set(remedies)).toEqual(new Set(["restart_with_restatement"]));
	});

	it("spends one card's budget without touching another's", () => {
		for (let attempt = 0; attempt < MAX_RESTATEMENT_RESTARTS; attempt += 1) {
			recordOffTrackRestart("card-1");
		}

		expect(decideOffTrackRemedy(offTrackWithNothingToSave("card-1")).remedy).toBe("park");
		expect(decideOffTrackRemedy(offTrackWithNothingToSave("card-2")).remedy).toBe("restart_with_restatement");
	});

	it("a forgotten card gets its budget back", () => {
		for (let attempt = 0; attempt < MAX_RESTATEMENT_RESTARTS; attempt += 1) {
			recordOffTrackRestart("card-1");
		}
		expect(decideOffTrackRemedy(offTrackWithNothingToSave("card-1")).remedy).toBe("park");

		forgetOffTrackRestarts("card-1");
		expect(decideOffTrackRemedy(offTrackWithNothingToSave("card-1")).remedy).toBe("restart_with_restatement");
	});

	it("captured work still wins over the budget — park protects the diff either way", () => {
		// The cap is not the only reason to park, and it must not become the only one: a card with reviewable work
		// parks on its first off-track verdict, budget untouched.
		const decision = decideOffTrackRemedy({
			onTrack: false,
			hasCapturedWork: true,
			contextUtilisation: 0.95,
			restartsSoFar: getOffTrackRestartCount("card-1"),
		});

		expect(decision.remedy).toBe("park");
		expect(getOffTrackRestartCount("card-1")).toBe(0);
	});
});
