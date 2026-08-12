import { describe, expect, it } from "vitest";
import { buildMechanismDecision, MIN_OBSERVATIONS_FOR_VERDICT } from "../../../src/core/mechanism-decision-report";
import {
	buildTaskOutcomeIndex,
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

describe("buildTaskOutcomeIndex", () => {
	it("reads succeeded/failed from the scheduler's terminal records", () => {
		const index = buildTaskOutcomeIndex([
			{ kind: "scheduler", event: "completed", taskId: "t1", detail: "succeeded" },
			{ kind: "scheduler", event: "completed", taskId: "t2", detail: "failed" },
		]);
		expect(index.get("t1")).toBe(true);
		expect(index.get("t2")).toBe(false);
	});

	it("does NOT treat transient_retry as an outcome", () => {
		// It is the scheduler returning a job to `ready` after a transient fault. Recording it as a failure would
		// blame the mechanism under test for an infrastructure hiccup — and the campaign's whole question is
		// whether the MECHANISM helps.
		const index = buildTaskOutcomeIndex([
			{ kind: "scheduler", event: "completed", taskId: "t1", detail: "transient_retry" },
		]);
		expect(index.has("t1")).toBe(false);
	});

	it("keeps the LAST terminal record, so a late success supersedes an earlier failure", () => {
		// `reportCompletion` documents accepting succeeded-on-failed: the runtime's bounce ladder can recover a
		// card after the durable budget already failed the job.
		const index = buildTaskOutcomeIndex([
			{ kind: "scheduler", event: "completed", taskId: "t1", detail: "failed" },
			{ kind: "scheduler", event: "completed", taskId: "t1", detail: "succeeded" },
		]);
		expect(index.get("t1")).toBe(true);
	});

	it("ignores non-scheduler and non-completed events", () => {
		const index = buildTaskOutcomeIndex([
			{ kind: "attempt", event: "completed", taskId: "t1", detail: "succeeded" },
			{ kind: "scheduler", event: "lease_acquired", taskId: "t2", detail: "succeeded" },
		]);
		expect(index.size).toBe(0);
	});
});

/**
 * The SESSION/CARD id namespace boundary — live-found 2026-08-02 on the first real drain.
 *
 * The gate emits from a task session whose id is the CARD id plus a per-session suffix, while the scheduler's
 * terminal records carry the card id. An exact-match join intersected in zero rows and always would have — the
 * "structurally zero" failure again, one level deeper, and invisible to fixtures that match ids by construction.
 * These ids are copied from the real drain, not invented.
 */
describe("joining across the session/card id boundary", () => {
	const CARD = "devtest-habit-insights-mid-1785625582977";
	const SESSION = "devtest-habit-insights-mid-1785625582977-1785625755525-5mmhsijz";

	it("joins a SESSION-suffixed observation to its card's outcome", () => {
		const report = joinToolGateObservations({
			records: [{ taskId: SESSION, offered: 28, wouldKeep: 7, wouldDrop: 21 }],
			outcomeByTaskId: new Map([[CARD, true]]),
		});
		expect(report.observations[0]?.succeeded).toBe(true);
		expect(report.unjoinedOutcomes).toBe(0);
	});

	it("prefers an EXACT match over any prefix", () => {
		const report = joinToolGateObservations({
			records: [{ taskId: SESSION, offered: 28, wouldKeep: 7, wouldDrop: 21 }],
			outcomeByTaskId: new Map([
				[CARD, false],
				[SESSION, true],
			]),
		});
		expect(report.observations[0]?.succeeded).toBe(true);
	});

	it("prefers the LONGEST card prefix when one card id prefixes another", () => {
		// Card ids end in timestamps, so one CAN be a proper prefix of another. Longest wins, deterministically —
		// the most specific card is the one the session actually belongs to.
		const report = joinToolGateObservations({
			records: [{ taskId: "card-12-99-suffix", offered: 10, wouldKeep: 7, wouldDrop: 3 }],
			outcomeByTaskId: new Map([
				["card-12", false],
				["card-12-99", true],
			]),
		});
		expect(report.observations[0]?.succeeded).toBe(true);
	});

	it("requires the prefix to end at a `-` boundary, never mid-token", () => {
		// "devtest-habit-1" must not claim sessions of "devtest-habit-10".
		const report = joinToolGateObservations({
			records: [{ taskId: "devtest-habit-10-555-abc", offered: 10, wouldKeep: 7, wouldDrop: 3 }],
			outcomeByTaskId: new Map([["devtest-habit-1", true]]),
		});
		expect(report.observations[0]?.succeeded).toBeNull();
		expect(report.unjoinedOutcomes).toBe(1);
	});

	it("still reports UNKNOWN when nothing matches", () => {
		const report = joinToolGateObservations({
			records: [{ taskId: SESSION, offered: 28, wouldKeep: 7, wouldDrop: 21 }],
			outcomeByTaskId: new Map([["some-other-card", true]]),
		});
		expect(report.observations[0]?.succeeded).toBeNull();
	});

	it("bridges DERIVED session ids (`::review`/`::spec`) to the primary card's outcome (audit 2026-08-12)", () => {
		const report = joinToolGateObservations({
			records: [
				{ taskId: `${CARD}::review`, offered: 10, wouldKeep: 7, wouldDrop: 3 },
				{ taskId: `${CARD}::spec`, offered: 10, wouldKeep: 10, wouldDrop: 0 },
			],
			outcomeByTaskId: new Map([[CARD, true]]),
		});
		expect(report.observations.map((entry) => entry.succeeded)).toEqual([true, true]);
		expect(report.unjoinedOutcomes).toBe(0);
	});

	it("an exact match on the DERIVED id itself still wins over the stripped primary", () => {
		const report = joinToolGateObservations({
			records: [{ taskId: `${CARD}::review`, offered: 10, wouldKeep: 7, wouldDrop: 3 }],
			outcomeByTaskId: new Map([
				[CARD, false],
				[`${CARD}::review`, true],
			]),
		});
		expect(report.observations[0]?.succeeded).toBe(true);
	});
});
