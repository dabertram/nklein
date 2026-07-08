import { describe, expect, it } from "vitest";
import {
	buildRoutingDecisionRecord,
	type RoutingDecisionRecord,
	summarizeRoutingCalibration,
} from "../../../src/core/routing-decision-log";

function record(overrides: Partial<RoutingDecisionRecord>): RoutingDecisionRecord {
	return buildRoutingDecisionRecord({
		taskId: "t",
		routeType: "assign",
		difficulty: 40,
		recordedAt: 1,
		...overrides,
	});
}

describe("routing-decision log", () => {
	describe("buildRoutingDecisionRecord", () => {
		it("fills sensible defaults and clamps", () => {
			const r = buildRoutingDecisionRecord({ taskId: "t", routeType: "escalate", difficulty: 200, recordedAt: 5 });
			expect(r).toMatchObject({
				predictedModelKey: null,
				difficulty: 100, // clamped
				actualOutcome: null,
				verifierOutcome: "not_run",
				uncertainty: null,
				resourceState: null,
			});
		});

		it("clamps uncertainty into [0,1] and coerces a non-finite difficulty to 0", () => {
			expect(
				buildRoutingDecisionRecord({
					taskId: "t",
					routeType: "assign",
					difficulty: Number.NaN,
					recordedAt: 1,
					uncertainty: 1.5,
				}).difficulty,
			).toBe(0);
			expect(
				buildRoutingDecisionRecord({
					taskId: "t",
					routeType: "assign",
					difficulty: 1,
					recordedAt: 1,
					uncertainty: 1.5,
				}).uncertainty,
			).toBe(1);
			expect(
				buildRoutingDecisionRecord({
					taskId: "t",
					routeType: "assign",
					difficulty: 1,
					recordedAt: 1,
					uncertainty: -3,
				}).uncertainty,
			).toBe(0);
		});
	});

	describe("summarizeRoutingCalibration", () => {
		it("is total over an empty batch", () => {
			expect(summarizeRoutingCalibration([])).toMatchObject({
				total: 0,
				runCount: 0,
				successRate: 0,
				verifierPassRate: 0,
				escalationRate: 0,
				meanUncertainty: null,
				uncertaintyFailureGap: null,
			});
		});

		it("computes success + verifier + escalation rates and route counts", () => {
			const records = [
				record({ routeType: "assign", actualOutcome: "success", verifierOutcome: "pass" }),
				record({ routeType: "assign", actualOutcome: "timeout", verifierOutcome: "fail" }),
				record({ routeType: "escalate" }),
				record({ routeType: "decompose" }),
			];
			const s = summarizeRoutingCalibration(records);
			expect(s.total).toBe(4);
			expect(s.runCount).toBe(2);
			expect(s.successRate).toBe(0.5); // 1 of 2 runs succeeded
			expect(s.verifierPassRate).toBe(0.5); // 1 of 2 verifier runs passed
			expect(s.escalationRate).toBe(0.25); // 1 of 4
			expect(s.routeTypeCounts).toEqual({ assign: 2, route_up: 0, decompose: 1, escalate: 1 });
		});

		it("reports a POSITIVE uncertaintyFailureGap when the router was more uncertain about the runs that failed", () => {
			const records = [
				record({ actualOutcome: "success", uncertainty: 0.2 }),
				record({ actualOutcome: "success", uncertainty: 0.3 }),
				record({ actualOutcome: "other_failure", uncertainty: 0.8 }),
				record({ actualOutcome: "timeout", uncertainty: 0.7 }),
			];
			const s = summarizeRoutingCalibration(records);
			// mean failed (0.75) − mean succeeded (0.25) = 0.5 > 0 ⇒ well-calibrated.
			expect(s.uncertaintyFailureGap).toBeCloseTo(0.5, 5);
			expect(s.meanUncertainty).toBeCloseTo(0.5, 5);
		});

		it("uncertaintyFailureGap is null without both a failed and a succeeded uncertainty-bearing run", () => {
			expect(
				summarizeRoutingCalibration([record({ actualOutcome: "success", uncertainty: 0.2 })]).uncertaintyFailureGap,
			).toBeNull();
		});
	});
});
