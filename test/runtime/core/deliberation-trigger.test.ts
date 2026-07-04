import { describe, expect, it } from "vitest";
import { type DeliberationTriggerInput, shouldDeliberate } from "../../../src/core/deliberation-trigger";

/** A high-stakes, low-confidence, diverse-critic-available, budget-remaining input — the ONE case that deliberates. */
const deliberating = (over: Partial<DeliberationTriggerInput> = {}): DeliberationTriggerInput => ({
	stakes: "high",
	confidence: "low",
	diverseCriticAvailable: true,
	budgetRemaining: 3,
	...over,
});

describe("shouldDeliberate (§5.AW)", () => {
	it("deliberates ONLY on high-stakes × non-high-confidence × diverse-critic × budget-left", () => {
		const decision = shouldDeliberate(deliberating());
		expect(decision.deliberate).toBe(true);
		if (decision.deliberate) {
			expect(decision.reason).toContain("High-stakes");
		}
	});

	it("also deliberates at MEDIUM confidence (only high confidence suppresses)", () => {
		expect(shouldDeliberate(deliberating({ confidence: "medium" })).deliberate).toBe(true);
	});

	it("does NOT deliberate once the run's budget is exhausted — highest-precedence guard", () => {
		for (const budgetRemaining of [0, -1]) {
			const decision = shouldDeliberate(deliberating({ budgetRemaining }));
			expect(decision.deliberate).toBe(false);
			expect(decision.reason).toContain("budget");
			if (!decision.deliberate) {
				expect(decision.diversityWaived).toBe(false);
			}
		}
	});

	it("budget exhaustion outranks a would-otherwise-deliberate high-stakes case (precedence)", () => {
		// Every other signal says deliberate, but no budget → suppressed, and NOT flagged as a diversity waiver.
		const decision = shouldDeliberate(deliberating({ budgetRemaining: 0 }));
		expect(decision).toEqual({
			deliberate: false,
			reason: "Deliberation budget for this run is exhausted.",
			diversityWaived: false,
		});
	});

	it("does NOT deliberate when stakes are low or medium (a cheap-to-fix call needs no debate)", () => {
		for (const stakes of ["low", "medium"] as const) {
			const decision = shouldDeliberate(deliberating({ stakes }));
			expect(decision.deliberate).toBe(false);
			expect(decision.reason).toContain(`Stakes are ${stakes}`);
			if (!decision.deliberate) {
				expect(decision.diversityWaived).toBe(false);
			}
		}
	});

	it("does NOT deliberate when the decider is already confident (debate adds latency, not info)", () => {
		const decision = shouldDeliberate(deliberating({ confidence: "high" }));
		expect(decision.deliberate).toBe(false);
		expect(decision.reason).toContain("already confident");
		if (!decision.deliberate) {
			expect(decision.diversityWaived).toBe(false);
		}
	});

	it("suppresses with diversityWaived=true when no lineage-diverse critic is loaded (a same-family debate is noise)", () => {
		const decision = shouldDeliberate(deliberating({ diverseCriticAvailable: false }));
		expect(decision.deliberate).toBe(false);
		if (!decision.deliberate) {
			expect(decision.diversityWaived).toBe(true);
			expect(decision.reason).toContain("same-family");
		}
	});

	it("high confidence outranks the missing-critic waiver (confidence is checked first)", () => {
		// Both high-confidence AND no-diverse-critic hold; confidence wins → NOT flagged as a diversity waiver.
		const decision = shouldDeliberate(deliberating({ confidence: "high", diverseCriticAvailable: false }));
		expect(decision.deliberate).toBe(false);
		if (!decision.deliberate) {
			expect(decision.diversityWaived).toBe(false);
		}
	});
});
