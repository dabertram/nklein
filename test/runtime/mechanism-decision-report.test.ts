import { describe, expect, it } from "vitest";
import {
	buildMechanismDecision,
	type MechanismObservation,
	MIN_EVALUABLE_DISAGREEMENTS,
	MIN_OBSERVATIONS_FOR_VERDICT,
} from "../../src/core/mechanism-decision-report";

function obs(n: number, make: (i: number) => MechanismObservation): MechanismObservation[] {
	return Array.from({ length: n }, (_, i) => make(i));
}

describe("buildMechanismDecision", () => {
	it("refuses a verdict below the observation floor", () => {
		const decision = buildMechanismDecision(obs(5, () => ({ recommended: "a", actual: "b", succeeded: true })));
		expect(decision.verdict).toBe("insufficient_data");
	});

	it("distinguishes INSUFFICIENT_DATA from do_not_enforce in its own words", () => {
		const decision = buildMechanismDecision(obs(3, () => ({ recommended: "a", actual: "b", succeeded: true })));
		expect(decision.reason).toContain('not "do not enforce"');
	});

	it("reports NO_OP when the mechanism never disagrees — enforcing would change nothing", () => {
		const decision = buildMechanismDecision(
			obs(MIN_OBSERVATIONS_FOR_VERDICT + 5, () => ({ recommended: "same", actual: "same", succeeded: true })),
		);
		expect(decision.verdict).toBe("no_op");
		expect(decision.reason).toContain("do not flip it and claim a win");
	});

	it("refuses when disagreements lack KNOWN outcomes — unrecorded is not failure", () => {
		const decision = buildMechanismDecision(
			obs(MIN_OBSERVATIONS_FOR_VERDICT + 5, () => ({ recommended: "a", actual: "b", succeeded: null })),
		);
		expect(decision.verdict).toBe("insufficient_data");
		expect(decision.reason).toContain("not a failure");
	});

	it("says DO_NOT_ENFORCE when current behaviour succeeds on the very cards it objects to", () => {
		const decision = buildMechanismDecision(obs(40, () => ({ recommended: "a", actual: "b", succeeded: true })));
		expect(decision.verdict).toBe("do_not_enforce");
	});

	it("says ENFORCE only when the taken path is actually failing", () => {
		const decision = buildMechanismDecision(
			obs(40, (i) => ({ recommended: "a", actual: "b", succeeded: i % 4 === 0 })),
		);
		expect(decision.verdict).toBe("enforce");
		// Even then it defers the real decision to a paired A/B rather than claiming this rate suffices.
		expect(decision.reason).toContain("PAIRED A/B");
	});

	it("counts disagreements and evaluable outcomes separately", () => {
		const decision = buildMechanismDecision([
			...obs(20, () => ({ recommended: "a", actual: "a", succeeded: true })),
			...obs(20, () => ({ recommended: "a", actual: "b", succeeded: null })),
		]);
		expect(decision.disagreements).toBe(20);
		expect(decision.evaluable).toBe(0);
	});

	it("exposes its thresholds as named constants so they can be pre-registered", () => {
		expect(MIN_OBSERVATIONS_FOR_VERDICT).toBeGreaterThan(0);
		expect(MIN_EVALUABLE_DISAGREEMENTS).toBeGreaterThan(0);
	});

	it("never throws on an empty stream", () => {
		expect(() => buildMechanismDecision([])).not.toThrow();
		expect(buildMechanismDecision([]).verdict).toBe("insufficient_data");
	});
});
