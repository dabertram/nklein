import { describe, expect, it } from "vitest";
import { buildMechanismDecision, MIN_OBSERVATIONS_FOR_VERDICT } from "../../../src/core/mechanism-decision-report";
import {
	GATE_KEEP_ALL,
	GATE_RECOMMENDED_WITHHOLD,
	joinToolGateObservations,
} from "../../../src/core/tool-gate-observation-join";

/**
 * P15.3 — the join that makes a tool-gate counterfactual decidable.
 *
 * The gate emits `{offered, wouldKeep, wouldDrop}`; the decision core needs `{recommended, actual, succeeded}`.
 * `succeeded` is a fact about how the CARD ended and lives nowhere near the observation, which is why the emit site
 * had to start carrying a `taskId` first.
 */

function record(wouldDrop: number, taskId?: string) {
	return { taskId, offered: 20, wouldKeep: 20 - wouldDrop, wouldDrop };
}

describe("joinToolGateObservations", () => {
	it("reads wouldDrop > 0 as a DISAGREEMENT with what the system did", () => {
		const report = joinToolGateObservations({
			records: [record(5, "t1")],
			outcomeByTaskId: new Map([["t1", true]]),
		});
		expect(report.observations[0]).toEqual({
			recommended: GATE_RECOMMENDED_WITHHOLD,
			actual: GATE_KEEP_ALL,
			succeeded: true,
		});
	});

	it("reads wouldDrop === 0 as AGREEMENT", () => {
		const report = joinToolGateObservations({ records: [record(0, "t1")], outcomeByTaskId: new Map() });
		expect(report.observations[0]?.recommended).toBe(GATE_KEEP_ALL);
		expect(report.observations[0]?.actual).toBe(GATE_KEEP_ALL);
	});

	it("always reports `actual` as keep_all — the gate never withheld anything", () => {
		// This is what makes it a clean counterfactual: the mechanism has never influenced the world it is
		// being compared against.
		const report = joinToolGateObservations({
			records: [record(9, "t1"), record(0, "t2")],
			outcomeByTaskId: new Map(),
		});
		expect(report.observations.every((entry) => entry.actual === GATE_KEEP_ALL)).toBe(true);
	});

	it("leaves an unjoinable outcome NULL rather than guessing either way", () => {
		// `false` would manufacture evidence that enforcement was needed; `true` that it was not. Both invent the
		// answer the campaign exists to find.
		const report = joinToolGateObservations({ records: [record(3, "t-unknown")], outcomeByTaskId: new Map() });
		expect(report.observations[0]?.succeeded).toBeNull();
		expect(report.unjoinedOutcomes).toBe(1);
	});

	it("keeps a LEGACY record with no taskId as an observation, unevaluable", () => {
		// It is real evidence the gate fired; it just cannot answer the counterfactual. Dropping it would
		// under-report firing, which is the other half of the same honesty.
		const report = joinToolGateObservations({ records: [record(4)], outcomeByTaskId: new Map() });
		expect(report.observations).toHaveLength(1);
		expect(report.observations[0]?.succeeded).toBeNull();
	});

	it("EXCLUDES a malformed record instead of reading it as agreement", () => {
		// Counting an unusable record as agreement dilutes the disagreement rate toward zero, and a gate that
		// never disagrees earns the `no_op` verdict — which ends in deletion. A parsing gap must not delete a
		// mechanism.
		const report = joinToolGateObservations({
			records: [{ taskId: "t1" }, { taskId: "t2", wouldDrop: Number.NaN }, { taskId: "t3", wouldDrop: -1 }],
			outcomeByTaskId: new Map(),
		});
		expect(report.observations).toHaveLength(0);
		expect(report.unusableRecords).toBe(3);
	});

	it("says plainly that an empty join proves nothing", () => {
		expect(joinToolGateObservations({ records: [], outcomeByTaskId: new Map() }).summary).toMatch(
			/says nothing about whether the gate should enforce/u,
		);
	});

	it("distinguishes a DATA GAP from a no-op gate in its own summary", () => {
		// The misread this whole item is about: `evaluable: 0` reads as "the gate never mattered" unless the
		// summary says otherwise.
		const report = joinToolGateObservations({ records: [record(6, "t1")], outcomeByTaskId: new Map() });
		expect(report.summary).toMatch(/data gap, NOT evidence the gate is a no-op/u);
	});
});

describe("the join feeds the decision core end to end", () => {
	it("produces insufficient_data below the observation floor, as designed", () => {
		const report = joinToolGateObservations({
			records: [record(5, "t1"), record(0, "t2")],
			outcomeByTaskId: new Map([
				["t1", false],
				["t2", true],
			]),
		});
		expect(buildMechanismDecision(report.observations).verdict).toBe("insufficient_data");
	});

	it("reaches a real verdict once enough joined observations exist", () => {
		// The property that proves the pipeline is no longer structurally blocked: with outcomes joined, volume
		// alone decides. Before the taskId landed, no volume could.
		const records = Array.from({ length: MIN_OBSERVATIONS_FOR_VERDICT + 20 }, (_, index) =>
			record(index % 2 === 0 ? 6 : 0, `t${index}`),
		);
		const outcomeByTaskId = new Map(records.map((entry, index) => [entry.taskId as string, index % 4 !== 0]));
		const report = joinToolGateObservations({ records, outcomeByTaskId });

		expect(report.unjoinedOutcomes).toBe(0);
		expect(buildMechanismDecision(report.observations).verdict).not.toBe("insufficient_data");
	});
});
