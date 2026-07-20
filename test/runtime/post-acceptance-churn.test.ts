import { describe, expect, it } from "vitest";
import {
	assessChurn,
	type ChurnObservation,
	MIN_AUTHORED_LINES,
	summariseChurn,
} from "../../src/core/post-acceptance-churn";

function observation(overrides: Partial<ChurnObservation> = {}): ChurnObservation {
	return { cardId: "c1", authoredLines: 100, churnedWithin24h: 5, churnedWithin7d: 15, ...overrides };
}

describe("assessChurn", () => {
	it("calls low 24h churn healthy — the work survived contact", () => {
		const result = assessChurn(observation());
		expect(result.verdict).toBe("healthy");
		expect(result.reason).toContain("survived contact");
	});

	it("calls majority same-day churn REWRITTEN, whatever the board recorded", () => {
		// The point: churn is written by the people who had to live with the result, so it is the one quality
		// signal an agent cannot influence — unlike the board, which P20.1 showed is forgeable.
		const result = assessChurn(observation({ churnedWithin24h: 60, churnedWithin7d: 70 }));
		expect(result.verdict).toBe("rewritten");
		expect(result.reason).toContain("WRONG ON ARRIVAL");
	});

	it("judges on the 24h rate, NOT the 7d rate", () => {
		// Seven-day churn conflates 'this was wrong' with 'the code evolved', and punishing evolution would push
		// the harness toward work nobody touches — which is not the same as work that was right.
		const result = assessChurn(observation({ churnedWithin24h: 2, churnedWithin7d: 90 }));
		expect(result.verdict).toBe("healthy");
		expect(result.iterationGap).toBeCloseTo(0.88, 2);
	});

	it("reports the iteration GAP, which separates wrong-on-arrival from moved-since", () => {
		const result = assessChurn(observation({ churnedWithin24h: 10, churnedWithin7d: 40 }));
		expect(result.iterationGap).toBeCloseTo(0.3, 2);
	});

	it("refuses a rate on too few authored lines — that is arithmetic, not signal", () => {
		// A 3-of-4 card reports 75% and would dominate any ranking sorted by churn rate.
		const result = assessChurn(observation({ authoredLines: 4, churnedWithin24h: 3, churnedWithin7d: 3 }));
		expect(result.verdict).toBe("indeterminate");
		expect(result.rate24h).toBeNull();
		expect(result.reason).toContain("arithmetic rather than signal");
	});

	it("judges exactly at the minimum line count", () => {
		const result = assessChurn(
			observation({ authoredLines: MIN_AUTHORED_LINES, churnedWithin24h: 0, churnedWithin7d: 0 }),
		);
		expect(result.verdict).toBe("healthy");
	});

	it("clamps a 7d figure BELOW the 24h one rather than reporting negative iteration", () => {
		// 7d includes 24h by definition; a caller reporting less is describing something else, and a negative gap
		// would read as code being un-churned.
		const result = assessChurn(observation({ churnedWithin24h: 30, churnedWithin7d: 10 }));
		expect(result.iterationGap).toBe(0);
	});

	it("clamps churn above the authored count", () => {
		const result = assessChurn(observation({ authoredLines: 50, churnedWithin24h: 999, churnedWithin7d: 999 }));
		expect(result.rate24h).toBe(1);
	});

	it("marks the elevated band between healthy and rewritten", () => {
		expect(assessChurn(observation({ churnedWithin24h: 30, churnedWithin7d: 35 })).verdict).toBe("elevated");
	});
});

describe("summariseChurn", () => {
	it("EXCLUDES too-small cards from the mean and says how many", () => {
		// Averaging them lets a handful of 3-line cards swing the mean; dropping them silently hides that the
		// sample covers fewer cards than it appears to.
		const summary = summariseChurn([
			observation({ cardId: "big", authoredLines: 200, churnedWithin24h: 20, churnedWithin7d: 30 }),
			observation({ cardId: "tiny", authoredLines: 3, churnedWithin24h: 3, churnedWithin7d: 3 }),
		]);
		expect(summary.indeterminate).toHaveLength(1);
		expect(summary.meanRate24h).toBeCloseTo(0.1, 2);
		expect(summary.text).toContain("too small to judge");
	});

	it("says UNMEASURED rather than low when no card is judgeable", () => {
		const summary = summariseChurn([observation({ authoredLines: 2, churnedWithin24h: 0, churnedWithin7d: 0 })]);
		expect(summary.meanRate24h).toBeNull();
		expect(summary.text).toContain("not the same as low");
	});

	it("handles an empty set", () => {
		expect(summariseChurn([]).meanRate24h).toBeNull();
	});
});
