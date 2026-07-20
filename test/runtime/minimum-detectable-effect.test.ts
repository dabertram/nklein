import { describe, expect, it } from "vitest";
import { assessPreRegistration, computeMinimumDetectableEffect } from "../../src/core/minimum-detectable-effect";

describe("computeMinimumDetectableEffect", () => {
	it("reports a LARGER detectable effect for a smaller task set", () => {
		const small = computeMinimumDetectableEffect({ taskCount: 20 });
		const large = computeMinimumDetectableEffect({ taskCount: 500 });
		expect(small.achievableMdePoints).toBeGreaterThan(large.achievableMdePoints);
	});

	it("shows that repeats SATURATE against the task-count floor", () => {
		// The result people routinely get wrong: repeats fix run noise, only more tasks fix task-sampling noise.
		const few = computeMinimumDetectableEffect({ taskCount: 100, repeats: 1 });
		const many = computeMinimumDetectableEffect({ taskCount: 100, repeats: 50 });
		expect(many.achievableMdePoints).toBeLessThan(few.achievableMdePoints);
		// But it cannot go below the floor set by the task count alone.
		expect(many.achievableMdePoints).toBeGreaterThanOrEqual(many.taskFloorMdePoints * 0.99);
	});

	it("says outright when more repeats are wasted fleet hours", () => {
		const report = computeMinimumDetectableEffect({ taskCount: 100, repeats: 40 });
		expect(report.repeatsExhausted).toBe(true);
		expect(report.summary).toContain("wasted fleet hours");
	});

	it("does not claim repeats are exhausted at a single repeat", () => {
		const report = computeMinimumDetectableEffect({ taskCount: 100, repeats: 1 });
		expect(report.repeatsExhausted).toBe(false);
	});

	it("credits pairing with a real saving", () => {
		const paired = computeMinimumDetectableEffect({ taskCount: 100, paired: true });
		const unpaired = computeMinimumDetectableEffect({ taskCount: 100, paired: false });
		expect(paired.achievableMdePoints).toBeLessThan(unpaired.achievableMdePoints);
	});

	it("penalises clustered standard errors", () => {
		const naive = computeMinimumDetectableEffect({ taskCount: 100, clusterInflation: 1 });
		const clustered = computeMinimumDetectableEffect({ taskCount: 100, clusterInflation: 3 });
		expect(clustered.achievableMdePoints).toBeGreaterThan(naive.achievableMdePoints);
	});

	it("treats zero tasks as arithmetic, not pessimism", () => {
		const report = computeMinimumDetectableEffect({ taskCount: 0 });
		expect(Number.isFinite(report.achievableMdePoints)).toBe(false);
		expect(report.summary).toContain("arithmetic rather than a pessimistic estimate");
	});
});

describe("assessPreRegistration", () => {
	it("returns UNDERPOWERED_BY_CONSTRUCTION when the declared effect is too small to find", () => {
		// The whole point of computing this first: an underpowered study produces an expensive 'unresolved' that
		// reads like bad luck rather than like arithmetic.
		const assessment = assessPreRegistration({
			declaredMdePoints: 3,
			design: { taskCount: 40, repeats: 1 },
		});
		expect(assessment.verdict).toBe("underpowered_by_construction");
		expect(assessment.reason).toContain("nothing to weigh it against");
	});

	it("says how many tasks WOULD suffice", () => {
		const assessment = assessPreRegistration({ declaredMdePoints: 3, design: { taskCount: 40 } });
		expect(assessment.tasksNeeded).toBeGreaterThan(40);
	});

	it("warns that repeats will not close the gap when they are already exhausted", () => {
		const assessment = assessPreRegistration({
			declaredMdePoints: 2,
			design: { taskCount: 100, repeats: 40 },
		});
		expect(assessment.reason).toContain("Adding repeats will NOT close the gap");
	});

	it("passes a design that can answer its question", () => {
		const assessment = assessPreRegistration({
			declaredMdePoints: 20,
			design: { taskCount: 200, repeats: 3 },
		});
		expect(assessment.verdict).toBe("adequately_powered");
	});

	it("offers the honest alternatives rather than just refusing", () => {
		const assessment = assessPreRegistration({ declaredMdePoints: 1, design: { taskCount: 10 } });
		expect(assessment.reason).toContain("declaring a larger effect");
	});
});

describe("calibration against the published figures (checked, not assumed)", () => {
	it("MATCHES the 89–225-task '~10–18 pp' band", () => {
		const small = computeMinimumDetectableEffect({ taskCount: 89 });
		const large = computeMinimumDetectableEffect({ taskCount: 225 });
		expect(small.achievableMdePoints).toBeLessThan(20);
		expect(large.achievableMdePoints).toBeGreaterThan(9);
	});

	it("is ~2x CONSERVATIVE against Miller's n=969 figure — pinned as a known gap, not tuned away", () => {
		// Miller reports 3 pp at n=969. This gives ~6.4 pp even with pairing and clustering off. The gap is the
		// variance model: worst-case 2p(1-p) at p=0.5 rather than a paired discordant-rate term. The constants were
		// NOT fitted to reproduce the citation, because a formula tuned to a number it cannot derive is one nobody
		// can reason about later. Pinned so a future change that "fixes" it has to be deliberate.
		const naive = computeMinimumDetectableEffect({ taskCount: 969, paired: false, clusterInflation: 1 });
		expect(naive.achievableMdePoints).toBeGreaterThan(3);
		expect(naive.achievableMdePoints).toBeLessThan(10);
	});

	it("errs in the SAFE direction — over-stating, never under-stating, the detectable effect", () => {
		// Over-stating costs extra tasks. Under-stating would bless an underpowered study as adequate, which is the
		// failure this module exists to prevent.
		const assessment = assessPreRegistration({ declaredMdePoints: 3, design: { taskCount: 969 } });
		expect(assessment.verdict).toBe("underpowered_by_construction");
	});
});
