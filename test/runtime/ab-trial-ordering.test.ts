import { describe, expect, it } from "vitest";
import {
	type Arm,
	buildAbbaSchedule,
	detectThermalDrift,
	summariseTrials,
	type Trial,
} from "../../src/core/ab-trial-ordering";

describe("buildAbbaSchedule", () => {
	it("interleaves ABBA rather than blocking A then B", () => {
		expect(buildAbbaSchedule(1)).toEqual(["a", "b", "b", "a"]);
	});

	it("gives both arms equal counts", () => {
		for (const pairs of [1, 2, 5, 10]) {
			const schedule = buildAbbaSchedule(pairs);
			const a = schedule.filter((arm) => arm === "a").length;
			expect(a).toBe(schedule.length - a);
		}
	});

	it("ALTERNATES the motif phase so one arm does not always own the coolest slot", () => {
		// A permanently owning position 0 of every block is a small bias that survives any number of repetitions.
		const schedule = buildAbbaSchedule(2);
		expect(schedule[0]).toBe("a");
		expect(schedule[4]).toBe("b");
	});

	it("balances mean POSITION between the arms — the property that cancels linear drift", () => {
		// Under a drift growing with time, equal mean position means equal average penalty, so the difference
		// between arms is unaffected. This is the whole reason for ABBA.
		const schedule = buildAbbaSchedule(6);
		const meanIndex = (arm: Arm) => {
			const positions = schedule.map((value, index) => (value === arm ? index : -1)).filter((i) => i >= 0);
			return positions.reduce((total, index) => total + index, 0) / positions.length;
		};
		expect(Math.abs(meanIndex("a") - meanIndex("b"))).toBeLessThan(0.5);
	});

	it("handles zero and negative pair counts", () => {
		expect(buildAbbaSchedule(0)).toEqual([]);
		expect(buildAbbaSchedule(-3)).toEqual([]);
	});
});

function trial(index: number, arm: Arm, durationMs: number, overrides: Partial<Trial> = {}): Trial {
	return { index, arm, durationMs, passed: true, ...overrides };
}

describe("detectThermalDrift", () => {
	it("detects a machine that slowed over the run", () => {
		const trials = [trial(0, "a", 1000), trial(1, "b", 1000), trial(2, "b", 1500), trial(3, "a", 1600)];
		const drift = detectThermalDrift(trials);
		expect(drift.drifting).toBe(true);
		expect(drift.detail).toContain("caps how long a session stays comparable");
	});

	it("reports no drift on a steady run", () => {
		const trials = [0, 1, 2, 3].map((i) => trial(i, i % 2 === 0 ? "a" : "b", 1000));
		expect(detectThermalDrift(trials).drifting).toBe(false);
	});

	it("says too few trials is ABSENCE OF A MEASUREMENT, not stability", () => {
		const drift = detectThermalDrift([trial(0, "a", 1000)]);
		expect(drift.drifting).toBe(false);
		expect(drift.detail).toContain("not evidence of stability");
	});

	it("sorts by execution index rather than trusting array order", () => {
		const shuffled = [trial(3, "a", 1600), trial(0, "a", 1000), trial(2, "b", 1500), trial(1, "b", 1000)];
		expect(detectThermalDrift(shuffled).drifting).toBe(true);
	});
});

describe("summariseTrials", () => {
	it("reports the infra-error rate ALONGSIDE the scores, never instead", () => {
		// A score without one is unfalsifiable: a 3pp difference means nothing if one arm suffered twice the
		// infrastructure failures, and the reader cannot tell.
		const trials = [
			trial(0, "a", 100),
			trial(1, "b", 100, { passed: false }),
			trial(2, "b", 100, { infraError: true }),
			trial(3, "a", 100),
		];
		const summary = summariseTrials(trials);
		expect(summary.infraErrorRate).toBeCloseTo(0.25, 2);
		expect(summary.text).toContain("infra-error rate");
	});

	it("EXCLUDES infra errors from pass rates rather than blaming an arm for the machine", () => {
		const trials = [trial(0, "a", 100), trial(1, "a", 100, { infraError: true, passed: false })];
		expect(summariseTrials(trials).armPassRate.a).toBe(1);
	});

	it("flags a run left UNBALANCED after dropping infra errors", () => {
		// Dropping them silently would hide that the comparison rests on fewer trials than it appears to.
		const trials = [
			trial(0, "a", 100),
			trial(1, "b", 100),
			trial(2, "b", 100),
			trial(3, "a", 100),
			trial(4, "b", 100, { infraError: true }),
			trial(5, "a", 100),
		];
		const summary = summariseTrials(trials);
		expect(summary.balanced).toBe(false);
		expect(summary.text).toContain("no longer paired");
	});

	it("refuses to render an absent run as a 0% score", () => {
		expect(summariseTrials([]).text).toContain("must not render as a 0% score");
	});
});
