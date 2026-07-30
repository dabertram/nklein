import { describe, expect, it } from "vitest";
import {
	checkLayerAAlwaysProducible,
	interpretNarrativeCompletion,
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

describe("P16.6b — interpretNarrativeCompletion (the POST-call half of the ladder)", () => {
	/**
	 * The failure this guards: a reasoning model answers a FREE-TEXT call with empty `message.content` and its
	 * thinking in `reasoning_content`. The local client's reasoning fallback is gated on `request.format`, i.e.
	 * structured calls only, so a narrative pass receives exactly "". Taken at face value that emits a report whose
	 * narrative section is blank while every status says the pass ran.
	 */
	it("passes real prose through for grounding", () => {
		const verdict = interpretNarrativeCompletion({ content: "The run completed with two bounces." });
		expect(verdict.outcome).toBe("narrative");
		expect(verdict.narrative).toBe("The run completed with two bounces.");
	});

	it("DEGRADES to Layer A when a reasoning model answers with thinking only", () => {
		// The exact P16.6b case. Layer A is pure aggregation and is complete without a model, so degrading loses
		// nothing real — whereas a blank section that reads as success looks like the model's considered opinion.
		const verdict = interpretNarrativeCompletion({
			content: "",
			reasoningContent: "Let me consider the report structure... I should summarise the bounces.",
		});
		expect(verdict.outcome).toBe("empty_degrade_to_layer_a");
		expect(verdict.reason).toContain("REASONING channel only");
	});

	it("NEVER promotes reasoning text into the narrative", () => {
		// The tempting fix, deliberately refused: on a free-text call that field is the model's thinking, and
		// publishing it would put a chain of thought into a user-facing report — worse than an empty section.
		const thinking = "internal deliberation that must never be published";
		const verdict = interpretNarrativeCompletion({ content: "", reasoningContent: thinking });
		expect(verdict.narrative).toBe("");
		expect(verdict.reason).not.toContain(thinking);
	});

	it("degrades on whitespace-only content — a blank line is not prose", () => {
		expect(interpretNarrativeCompletion({ content: "   \n  " }).outcome).toBe("empty_degrade_to_layer_a");
	});

	it("degrades on null/undefined without throwing into the report path", () => {
		for (const content of [null, undefined]) {
			expect(interpretNarrativeCompletion({ content }).outcome).toBe("empty_degrade_to_layer_a");
		}
	});
});
