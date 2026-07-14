import { describe, expect, it } from "vitest";
import { aggregateGateAudit, type GateOutcome } from "../../../src/core/gate-audit-metrics.js";

/** opencode-swarm gate-audit port — the confusion matrix + catch/false-reject/precision for a gate. */

const outcome = (gate: string, predictedReject: boolean, actualDefect: boolean): GateOutcome => ({
	gate,
	predictedReject,
	actualDefect,
});

describe("aggregateGateAudit", () => {
	it("computes the confusion matrix and rates for a single gate", () => {
		const outcomes = [
			outcome("reviewer", true, true), // TP
			outcome("reviewer", true, true), // TP
			outcome("reviewer", true, false), // FP (false reject)
			outcome("reviewer", false, false), // TN
			outcome("reviewer", false, false), // TN
			outcome("reviewer", false, true), // FN (missed defect)
		];
		const { overall } = aggregateGateAudit(outcomes);
		expect(overall).toMatchObject({ total: 6, truePositive: 2, falsePositive: 1, trueNegative: 2, falseNegative: 1 });
		expect(overall.catchRate).toBeCloseTo(2 / 3); // TP / (TP+FN) = 2/3
		expect(overall.falseRejectRate).toBeCloseTo(1 / 3); // FP / (FP+TN) = 1/3
		expect(overall.precision).toBeCloseTo(2 / 3); // TP / (TP+FP) = 2/3
	});

	it("splits stats per gate and sorts gate keys stably", () => {
		const report = aggregateGateAudit([
			outcome("quality_budget", true, false), // FP
			outcome("placeholder_scan", true, true), // TP
		]);
		expect(Object.keys(report.perGate)).toEqual(["placeholder_scan", "quality_budget"]);
		expect(report.perGate.placeholder_scan.catchRate).toBe(1);
		expect(report.perGate.quality_budget.falseRejectRate).toBe(1);
	});

	it("returns null rates when a denominator is empty (no defects / no clean / no rejects)", () => {
		// All clean work, all passed → no defects to catch, no rejects.
		const report = aggregateGateAudit([outcome("g", false, false), outcome("g", false, false)]);
		expect(report.overall.catchRate).toBeNull(); // no real defects
		expect(report.overall.precision).toBeNull(); // gate rejected nothing
		expect(report.overall.falseRejectRate).toBe(0); // 0 FP over clean work
	});

	it("handles an empty outcome set", () => {
		const report = aggregateGateAudit([]);
		expect(report.overall.total).toBe(0);
		expect(report.overall.catchRate).toBeNull();
		expect(report.perGate).toEqual({});
	});
});
