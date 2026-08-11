import { describe, expect, it } from "vitest";
import {
	joinOffTrackRemedyObservations,
	OFF_TRACK_ACTUAL_TODAY,
	toOffTrackRemedyRecord,
} from "../../../src/core/off-track-remedy-observation-join";

/**
 * P18.4b — the remedy stream's feed into the P15.2 decision core. The join's honesty rules mirror
 * tool-gate-observation-join: unusable records are counted (never silently agreement), unjoined outcomes stay
 * null (counted, not evaluable), and `actual` is the faithful constant "continue" until the acting half ships.
 */
describe("toOffTrackRemedyRecord", () => {
	it("lifts taskId and remedy, and nulls anything unusable", () => {
		expect(toOffTrackRemedyRecord({ taskId: "t1", metadata: { remedy: "park" } })).toEqual({
			taskId: "t1",
			remedy: "park",
		});
		expect(toOffTrackRemedyRecord({ taskId: "", metadata: { remedy: 7 } })).toEqual({
			taskId: null,
			remedy: null,
		});
	});
});

describe("joinOffTrackRemedyObservations", () => {
	it("maps remedy → recommended against the constant actual, joining outcomes by task id", () => {
		const report = joinOffTrackRemedyObservations({
			records: [
				{ taskId: "won", remedy: "restart_with_restatement" },
				{ taskId: "lost", remedy: "park" },
				{ taskId: "agree", remedy: "continue" },
			],
			outcomeByTaskId: new Map([
				["won", true],
				["lost", false],
			]),
		});
		expect(report.observations).toEqual([
			{ recommended: "restart_with_restatement", actual: OFF_TRACK_ACTUAL_TODAY, succeeded: true },
			{ recommended: "park", actual: OFF_TRACK_ACTUAL_TODAY, succeeded: false },
			{ recommended: "continue", actual: OFF_TRACK_ACTUAL_TODAY, succeeded: null },
		]);
		expect(report.unjoinedOutcomes).toBe(1);
		expect(report.unusableRecords).toBe(0);
	});

	it("counts an unknown remedy as unusable rather than as either agreement or disagreement", () => {
		// A typo'd or future remedy value must surface as a data problem: counting it as agreement dilutes the
		// disagreement rate toward no_op (which ends in deletion); counting it as disagreement manufactures
		// evidence for enforcement. Both directions are wrong, so neither is taken.
		const report = joinOffTrackRemedyObservations({
			records: [{ taskId: "t1", remedy: "reboot_universe" }],
			outcomeByTaskId: new Map([["t1", true]]),
		});
		expect(report.observations).toHaveLength(0);
		expect(report.unusableRecords).toBe(1);
	});
});
