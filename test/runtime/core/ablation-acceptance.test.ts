import { describe, expect, it } from "vitest";
import { foldAblationIntoAcceptance } from "../../../src/core/ablation-acceptance";
import type { AblationAssessment } from "../../../src/core/no-op-ablation";

/**
 * P20.3b — the acceptance fold.
 *
 * The whole design turns on an asymmetry, so the tests are organised around it rather than around the three
 * verdicts. Two failure directions, with very different costs:
 *
 *  · Holding a card on MISSING evidence punishes the card for the harness's own gaps. That is the same false
 *    accusation the ablation's exit codes already refuse to make about code, pointed at the card instead.
 *  · Recording "unmeasured" as if it were "supported" is the green-signal substitution — a card would carry
 *    positive evidence nobody produced.
 *
 * Both are pinned in both directions below. The third property is that `decorative` HOLDS rather than rejects,
 * and states BOTH readings of itself, because the reviewer can tell them apart and the gate cannot.
 */
const assessment = (over: Partial<AblationAssessment> = {}): AblationAssessment => ({
	verdict: "load_bearing",
	brokenByStub: ["a.test.ts::breaks"],
	indifferentTests: [],
	reason: "stubbing the artifact broke 1 of 1 baseline-green test(s)",
	...over,
});

describe("missing evidence never holds a card", () => {
	it("does not hold when the ablation could not run at all", () => {
		// A sandbox that was unavailable, a run that never happened. The card did nothing wrong.
		const evidence = foldAblationIntoAcceptance(null);

		expect(evidence.holdsAcceptance).toBe(false);
		expect(evidence.status).toBe("unmeasured");
	});

	it("does not hold on an INCONCLUSIVE verdict", () => {
		// The common real-world case: the stub broke test collection, or the suite was already red at baseline, so
		// the two runs cannot be compared. Blocking here would punish a card for the harness's limits.
		const evidence = foldAblationIntoAcceptance(
			assessment({ verdict: "inconclusive", brokenByStub: [], reason: "no baseline-green test was re-run" }),
		);

		expect(evidence.holdsAcceptance).toBe(false);
		expect(evidence.status).toBe("unmeasured");
	});

	it("carries the assessor's own reason forward rather than a generic one", () => {
		// The reviewer needs to know WHICH way the measurement failed; "unmeasured" alone is not actionable.
		const evidence = foldAblationIntoAcceptance(
			assessment({ verdict: "inconclusive", brokenByStub: [], reason: "the stub broke collection" }),
		);

		expect(evidence.detail).toMatch(/the stub broke collection/);
	});
});

describe("missing evidence is never recorded as positive evidence", () => {
	it("does not claim the tests measure the change when nothing was measured", () => {
		// The green-signal direction. `unmeasured` must not be usable as a pass by any consumer reading only the
		// boolean.
		for (const evidence of [
			foldAblationIntoAcceptance(null),
			foldAblationIntoAcceptance(assessment({ verdict: "inconclusive", brokenByStub: [] })),
		]) {
			expect(evidence.testsMeasureTheChange).toBe(false);
			expect(evidence.status).not.toBe("supported");
		}
	});

	it("does not claim it for a SUSPECT result either", () => {
		// A decorative verdict is the opposite of positive evidence; the boolean must not be true merely because
		// the ablation ran and produced something.
		const evidence = foldAblationIntoAcceptance(
			assessment({ verdict: "decorative", brokenByStub: [], indifferentTests: ["a.test.ts::x"] }),
		);

		expect(evidence.testsMeasureTheChange).toBe(false);
	});

	it("says so plainly when the ablation could not run", () => {
		expect(foldAblationIntoAcceptance(null).detail).toMatch(/could not run|unknown/i);
	});
});

describe("a load-bearing run is positive evidence", () => {
	it("marks the card supported and does not hold it", () => {
		const evidence = foldAblationIntoAcceptance(assessment());

		expect(evidence).toMatchObject({
			status: "supported",
			testsMeasureTheChange: true,
			holdsAcceptance: false,
		});
	});

	it("counts the tests the stub broke — the evidence itself, not just a label", () => {
		const evidence = foldAblationIntoAcceptance(assessment({ brokenByStub: ["a::1", "a::2", "b::3"] }));

		expect(evidence.detail).toMatch(/broke 3 baseline-green test/);
	});

	it("reports no indifferent tests to chase", () => {
		expect(foldAblationIntoAcceptance(assessment()).indifferentTests).toEqual([]);
	});
});

describe("a decorative run HOLDS, and says why it might be wrong", () => {
	const decorative = (indifferentTests: string[]) =>
		foldAblationIntoAcceptance(assessment({ verdict: "decorative", brokenByStub: [], indifferentTests }));

	it("holds the card rather than rejecting it", () => {
		const evidence = decorative(["a.test.ts::x"]);

		expect(evidence.holdsAcceptance).toBe(true);
		expect(evidence.status).toBe("suspect");
	});

	it("NAMES the tests that passed with and without the artifact", () => {
		// A hold with no list is a dead end. These are exactly the tests to read, and they are the evidence a
		// reviewer needs to dismiss the hold if it is wrong.
		const indifferentTests = ["a.test.ts::one", "b.test.ts::two"];

		expect(decorative(indifferentTests).indifferentTests).toEqual(indifferentTests);
	});

	it("states BOTH readings, not only the accusation", () => {
		// The gate cannot distinguish "the tests do not measure this change" from "the artifact is reached
		// indirectly and the ablation could not see it" — and this repo's own sweep produced twelve of the second
		// kind. Presenting only the first would report a harness artefact as a finding about the card.
		const detail = decorative(["a.test.ts::x"]).detail;

		expect(detail).toMatch(/do not measure/i);
		expect(detail).toMatch(/indirectly/i);
		expect(detail).toMatch(/re-export|caller|fixture/i);
	});

	it("tells the reviewer to decide, rather than asserting a verdict", () => {
		expect(decorative(["a::x"]).detail).toMatch(/confirm which/i);
	});

	it("counts the indifferent tests in the detail", () => {
		expect(decorative(["a::1", "a::2"]).detail).toMatch(/^2 test\(s\) passed with AND without/);
	});
});

describe("the three statuses stay distinguishable", () => {
	it("maps each verdict to exactly one status, and never collapses two", () => {
		const statuses = [
			foldAblationIntoAcceptance(assessment({ verdict: "load_bearing" })).status,
			foldAblationIntoAcceptance(assessment({ verdict: "decorative", brokenByStub: [] })).status,
			foldAblationIntoAcceptance(assessment({ verdict: "inconclusive", brokenByStub: [] })).status,
		];

		expect(statuses).toEqual(["supported", "suspect", "unmeasured"]);
	});

	it("holds for exactly one of the four inputs", () => {
		// Stated as a whole so the hold cannot quietly widen: only `decorative` blocks, and a null assessment sits
		// with `inconclusive` on the permissive side.
		const holds = [
			foldAblationIntoAcceptance(null),
			foldAblationIntoAcceptance(assessment({ verdict: "load_bearing" })),
			foldAblationIntoAcceptance(assessment({ verdict: "decorative", brokenByStub: [] })),
			foldAblationIntoAcceptance(assessment({ verdict: "inconclusive", brokenByStub: [] })),
		].map((evidence) => evidence.holdsAcceptance);

		expect(holds).toEqual([false, false, true, false]);
	});
});
