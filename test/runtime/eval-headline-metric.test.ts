import { describe, expect, it } from "vitest";
import {
	assertHeadlineMetricAllowed,
	buildHeadline,
	ForbiddenHeadlineError,
} from "../../src/core/eval-headline-metric";

describe("buildHeadline", () => {
	it("always reports BOTH pass^1-with-CI and pass^k", () => {
		// Either alone misleads in a predictable direction: pass^1 flatters a flaky system that occasionally works,
		// pass^k buries a real capability under end-to-end compounding.
		const report = buildHeadline({ successes: 30, runs: 40 });
		expect(report.text).toContain("pass^1");
		expect(report.text).toContain("pass^4");
		expect(report.low).toBeLessThan(report.point);
		expect(report.high).toBeGreaterThan(report.point);
	});

	it("flags an UNDERPOWERED result rather than reporting a bare rate", () => {
		// At local-fleet run counts the interval is usually wide enough to change the conclusion.
		const report = buildHeadline({ successes: 2, runs: 3 });
		expect(report.underpowered).toBe(true);
		expect(report.text).toContain("unresolved rather than as a result");
	});

	it("does not flag a well-powered result", () => {
		const report = buildHeadline({ successes: 190, runs: 200 });
		expect(report.underpowered).toBe(false);
	});

	it("refuses to render an absent measurement as 0%", () => {
		// A missing number and a measured zero are different claims.
		const report = buildHeadline({ successes: 0, runs: 0 });
		expect(report.text).toContain("no result to report");
		expect(report.underpowered).toBe(true);
	});

	it("shows the pass^1 / pass^k gap that matters for a multi-card board", () => {
		// The tau-bench shape: the headline says 'half the time', reliability says 'rarely, end to end'.
		const report = buildHeadline({ successes: 50, runs: 100, reliabilityK: 8 });
		expect(report.point).toBeCloseTo(0.5, 1);
		expect(report.passPowerK).toBeLessThan(0.1);
	});

	it("clamps nonsense input rather than throwing", () => {
		const report = buildHeadline({ successes: 999, runs: 10 });
		expect(report.point).toBeLessThanOrEqual(1);
	});
});

describe("assertHeadlineMetricAllowed", () => {
	it("THROWS on pass@k rather than warning", () => {
		// A warning would be read, acknowledged and ignored — the metric would still ship, because it is the number
		// that makes the change look best.
		expect(() => assertHeadlineMetricAllowed("pass@k")).toThrow(ForbiddenHeadlineError);
	});

	it("catches spelling variants", () => {
		for (const name of ["pass@k", "Pass @ K", "pass_at_k", "pass-at-8", "passAt4"]) {
			expect(() => assertHeadlineMetricAllowed(name)).toThrow(ForbiddenHeadlineError);
		}
	});

	it("explains WHY, so the rule survives the person who wrote it", () => {
		expect(() => assertHeadlineMetricAllowed("pass@k")).toThrow(/REWARDS VARIANCE/);
	});

	it("allows the metrics this item endorses", () => {
		for (const name of ["pass^1", "pass^4", "pass_power_k", "success_rate"]) {
			expect(() => assertHeadlineMetricAllowed(name)).not.toThrow();
		}
	});
});
