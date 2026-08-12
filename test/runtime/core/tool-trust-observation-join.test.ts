import { describe, expect, it } from "vitest";
import { joinToolTrustObservations, toToolTrustRecord } from "../../../src/core/tool-trust-observation-join";

/**
 * P15.3 mechanism #3 — the trust-decay stream's feed into the P15.2 decision core (first dedicated test, audit
 * 2026-08-12). Same honesty rules as the gate/remedy joins, plus the shared session/card id bridge: records emit
 * under SESSION ids (`<cardId>-<ts>-<rand>`, `<cardId>::review`) while outcomes key on CARD ids.
 */
describe("toToolTrustRecord", () => {
	it("lifts taskId, tool, tier, and enforced; nulls anything unusable", () => {
		expect(
			toToolTrustRecord({ taskId: "t1", metadata: { tool: "run_command", tier: "demoted", enforced: false } }),
		).toEqual({ taskId: "t1", tool: "run_command", tier: "demoted", enforced: false });
		expect(toToolTrustRecord({ taskId: "", metadata: { tool: 7, tier: "", enforced: "yes" } })).toEqual({
			taskId: null,
			tool: null,
			tier: null,
			enforced: null,
		});
	});
});

describe("joinToolTrustObservations", () => {
	const record = (
		taskId: string | null,
		overrides: Partial<Parameters<typeof joinToolTrustObservations>[0]["records"][number]> = {},
	) => ({
		taskId,
		tool: "run_command",
		tier: "dropped",
		enforced: false,
		...overrides,
	});

	it("joins an exact card-id match to its outcome", () => {
		const report = joinToolTrustObservations({
			records: [record("card-1")],
			outcomeByTaskId: new Map([["card-1", true]]),
		});
		expect(report.observations[0]).toEqual({
			recommended: "withhold_tool",
			actual: "kept_offering",
			succeeded: true,
		});
		expect(report.unjoinedOutcomes).toBe(0);
	});

	it("joins a session-shaped id (`<cardId>-<ts>-<rand>`) to its card's outcome", () => {
		const report = joinToolTrustObservations({
			records: [record("card-1-1723400000-ab12")],
			outcomeByTaskId: new Map([["card-1", false]]),
		});
		expect(report.observations[0]?.succeeded).toBe(false);
		expect(report.unjoinedOutcomes).toBe(0);
	});

	it("joins a derived-session id (`<cardId>::review`) to its card's outcome", () => {
		const report = joinToolTrustObservations({
			records: [record("card-1::review")],
			outcomeByTaskId: new Map([["card-1", true]]),
		});
		expect(report.observations[0]?.succeeded).toBe(true);
		expect(report.unjoinedOutcomes).toBe(0);
	});

	it("an unknown id joins with succeeded null — an unjoined outcome, never a failure", () => {
		const report = joinToolTrustObservations({
			records: [record("card-unrelated")],
			outcomeByTaskId: new Map([["card-1", true]]),
		});
		expect(report.observations[0]?.succeeded).toBeNull();
		expect(report.unjoinedOutcomes).toBe(1);
		expect(report.unusableRecords).toBe(0);
	});

	it("the enforced flag decides actual: applied recommendation vs kept_offering — unchanged by the bridge", () => {
		const report = joinToolTrustObservations({
			records: [record("card-1", { tier: "demoted", enforced: true }), record("card-1", { tier: "demoted" })],
			outcomeByTaskId: new Map([["card-1", true]]),
		});
		expect(report.observations[0]).toEqual({ recommended: "demote_tool", actual: "demote_tool", succeeded: true });
		expect(report.observations[1]).toEqual({
			recommended: "demote_tool",
			actual: "kept_offering",
			succeeded: true,
		});
	});

	it("counts records with no tool / unknown tier / unknown world (enforced null) as unusable", () => {
		const report = joinToolTrustObservations({
			records: [
				record("card-1", { tool: null }),
				record("card-1", { tier: "trusted" }),
				record("card-1", { enforced: null }),
			],
			outcomeByTaskId: new Map([["card-1", true]]),
		});
		expect(report.observations).toHaveLength(0);
		expect(report.unusableRecords).toBe(3);
	});
});
