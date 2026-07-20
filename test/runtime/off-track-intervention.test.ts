import { describe, expect, it } from "vitest";
import {
	decideOffTrackRemedy,
	discardsConversation,
	MAX_RESTATEMENT_RESTARTS,
	type OffTrackSignals,
} from "../../src/core/off-track-intervention";

function signals(overrides: Partial<OffTrackSignals> = {}): OffTrackSignals {
	return {
		onTrack: true,
		contextUtilisation: 0.4,
		restartsSoFar: 0,
		hasCapturedWork: false,
		...overrides,
	};
}

describe("decideOffTrackRemedy", () => {
	it("continues when on track with room to spare", () => {
		expect(decideOffTrackRemedy(signals()).remedy).toBe("continue");
	});

	it("compacts an ON-TRACK card that is filling its window", () => {
		const decision = decideOffTrackRemedy(signals({ contextUtilisation: 0.9 }));
		expect(decision.remedy).toBe("compact_and_continue");
		expect(decision.reason).toContain("too much of it");
	});

	it("NEVER compacts an off-track card, however full the window", () => {
		// The whole point: the same symptom (a large conversation) demands opposite remedies. Compacting here
		// preserves the wrong early commitment in a shorter, cleaner, more authoritative form.
		const decision = decideOffTrackRemedy(signals({ onTrack: false, contextUtilisation: 0.99 }));
		expect(decision.remedy).not.toBe("compact_and_continue");
		expect(decision.remedy).toBe("restart_with_restatement");
		expect(decision.reason).toContain("COMPACTION IS WRONG HERE");
	});

	it("checks off-track BEFORE context pressure, so a derailed card cannot fall into compaction", () => {
		// A derailed card is usually also a long one, so ordering these the other way would make compaction the
		// default for exactly the cards it harms most.
		for (const utilisation of [0.0, 0.5, 0.76, 1.0]) {
			expect(decideOffTrackRemedy(signals({ onTrack: false, contextUtilisation: utilisation })).remedy).toBe(
				"restart_with_restatement",
			);
		}
	});

	it("PARKS rather than restarts when the card has captured work", () => {
		// Restarting destroys artefacts a human could judge; a person can often salvage a half-right diff.
		const decision = decideOffTrackRemedy(signals({ onTrack: false, hasCapturedWork: true }));
		expect(decision.remedy).toBe("park");
		expect(decision.reason).toContain("salvage");
	});

	it("bounds restarts, then parks — unbounded restarting is a loop that looks like progress", () => {
		const spent = decideOffTrackRemedy(signals({ onTrack: false, restartsSoFar: MAX_RESTATEMENT_RESTARTS }));
		expect(spent.remedy).toBe("park");
		expect(spent.reason).toContain("restart budget");
	});

	it("allows restarts up to the budget", () => {
		for (let restarts = 0; restarts < MAX_RESTATEMENT_RESTARTS; restarts += 1) {
			expect(decideOffTrackRemedy(signals({ onTrack: false, restartsSoFar: restarts })).remedy).toBe(
				"restart_with_restatement",
			);
		}
	});

	it("captured work outranks the restart budget — both routes end at a human, for different reasons", () => {
		const decision = decideOffTrackRemedy(
			signals({ onTrack: false, hasCapturedWork: true, restartsSoFar: MAX_RESTATEMENT_RESTARTS }),
		);
		expect(decision.remedy).toBe("park");
		expect(decision.reason).toContain("reviewable work");
	});

	it("treats a non-finite utilisation as zero rather than throwing", () => {
		expect(decideOffTrackRemedy(signals({ contextUtilisation: Number.NaN })).remedy).toBe("continue");
	});
});

describe("discardsConversation", () => {
	it("is true only for the restarting remedy", () => {
		expect(discardsConversation("restart_with_restatement")).toBe(true);
		for (const remedy of ["continue", "compact_and_continue", "park"] as const) {
			expect(discardsConversation(remedy)).toBe(false);
		}
	});
});
