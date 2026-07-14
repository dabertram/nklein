import { describe, expect, it } from "vitest";
import {
	DEFAULT_DELIVERY_QUALITY_GATE_FIXTURES,
	runDeliveryQualityGateAudit,
} from "../../../src/core/delivery-quality-gate-audit.js";

/** gate-audit given a real, non-speculative consumer: the delivery-quality gate over a labeled fixture matrix. */
describe("runDeliveryQualityGateAudit", () => {
	it("classifies the default fixtures with a perfect confusion matrix (the gate is accurate on knowns)", () => {
		const { report, rows } = runDeliveryQualityGateAudit();
		// Every hand-labeled fixture should be classified correctly — no false rejects, no missed defects.
		expect(rows.every((row) => row.correct)).toBe(true);
		expect(report.overall.falsePositive).toBe(0);
		expect(report.overall.falseNegative).toBe(0);
		expect(report.overall.catchRate).toBe(1);
		expect(report.overall.falseRejectRate).toBe(0);
	});

	it("the clean TODO-in-a-string fixture is NOT held (guards against over-eager placeholder matching)", () => {
		const { rows } = runDeliveryQualityGateAudit();
		const stringTodo = rows.find((row) => row.name === "clean-todo-in-string-literal");
		expect(stringTodo?.held).toBe(false);
	});

	it("counts the labeled defects vs clean controls", () => {
		const defects = DEFAULT_DELIVERY_QUALITY_GATE_FIXTURES.filter((f) => f.expectDefect).length;
		const clean = DEFAULT_DELIVERY_QUALITY_GATE_FIXTURES.length - defects;
		const { report } = runDeliveryQualityGateAudit();
		expect(report.overall.truePositive).toBe(defects);
		expect(report.overall.trueNegative).toBe(clean);
	});

	it("disabling both sub-gates makes every fixture pass → the defects become misses (false negatives)", () => {
		const { report } = runDeliveryQualityGateAudit(DEFAULT_DELIVERY_QUALITY_GATE_FIXTURES, {
			placeholderScanEnabled: false,
			qualityBudgetEnabled: false,
		});
		expect(report.overall.truePositive).toBe(0);
		expect(report.overall.catchRate).toBe(0); // caught nothing
	});
});
