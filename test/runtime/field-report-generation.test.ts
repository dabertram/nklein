import { describe, expect, it } from "vitest";
import {
	checkLayerAAlwaysProducible,
	NARRATIVE_GROUNDING_BAR,
	planFieldReportGeneration,
} from "../../src/core/field-report-generation";

describe("planFieldReportGeneration", () => {
	it("produces Layer A with NO model — the report is complete, only the prose is missing", () => {
		const plan = planFieldReportGeneration({ modelAvailable: false });
		expect(plan.attemptLayers).toEqual(["A"]);
		expect(plan.narrativeEnabled).toBe(false);
		expect(plan.reason).toContain("complete and correct without one");
	});

	it("attempts a narrative for a model with NO grounding history", () => {
		// Grounding filters the result anyway, so an unproven attempt costs tokens, not correctness.
		const plan = planFieldReportGeneration({ modelAvailable: true });
		expect(plan.narrativeEnabled).toBe(true);
		expect(plan.attemptLayers).toEqual(["A", "B"]);
	});

	it("STOPS attempting narrative for a model measured to ground poorly", () => {
		const plan = planFieldReportGeneration({
			modelAvailable: true,
			recentGroundedRate: 0.2,
			reportsObserved: 5,
		});
		expect(plan.narrativeEnabled).toBe(false);
		expect(plan.reason).toContain("would be DISCARDED");
		// Layer A is unaffected — degradation never removes the arithmetic.
		expect(plan.attemptLayers).toEqual(["A"]);
	});

	it("treats a thin grounding history as no evidence, not as a poor rate", () => {
		const plan = planFieldReportGeneration({
			modelAvailable: true,
			recentGroundedRate: 0.1,
			reportsObserved: 1,
		});
		expect(plan.narrativeEnabled).toBe(true);
	});

	it("marks a well-grounded model capable", () => {
		const plan = planFieldReportGeneration({
			modelAvailable: true,
			recentGroundedRate: 0.9,
			reportsObserved: 5,
		});
		expect(plan.capability).toBe("grounded_capable");
	});

	it("ALWAYS includes Layer A whatever the capability", () => {
		for (const input of [
			{ modelAvailable: false },
			{ modelAvailable: true },
			{ modelAvailable: true, recentGroundedRate: 0.1, reportsObserved: 9 },
		]) {
			expect(planFieldReportGeneration(input).attemptLayers).toContain("A");
		}
	});

	it("uses the documented bar", () => {
		expect(NARRATIVE_GROUNDING_BAR).toBeGreaterThan(0);
		expect(NARRATIVE_GROUNDING_BAR).toBeLessThan(1);
	});
});

describe("checkLayerAAlwaysProducible", () => {
	it("passes when Layer A produced fields without a model", () => {
		const plan = planFieldReportGeneration({ modelAvailable: false });
		expect(checkLayerAAlwaysProducible({ structuralFieldCount: 7, plan }).ok).toBe(true);
	});

	it("flags an EMPTY Layer A as a telemetry defect, not a model problem", () => {
		const plan = planFieldReportGeneration({ modelAvailable: false });
		const check = checkLayerAAlwaysProducible({ structuralFieldCount: 0, plan });
		expect(check.ok).toBe(false);
		expect(check.reason).toContain("telemetry defect, not a model problem");
	});

	it("flags a plan that omitted Layer A as a bug", () => {
		const check = checkLayerAAlwaysProducible({
			structuralFieldCount: 5,
			plan: { capability: "none", attemptLayers: [], narrativeEnabled: false, reason: "" },
		});
		expect(check.ok).toBe(false);
		expect(check.reason).toContain("never optional");
	});
});
