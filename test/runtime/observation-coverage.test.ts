import { describe, expect, it } from "vitest";
import {
	auditObservationCoverage,
	MECHANISM_REGISTRY,
	OPERATIONAL_OBSERVATION_CATEGORIES,
} from "../../src/core/mechanism-observation-audit";

/**
 * The INVERSE of the mechanism audit.
 *
 * `auditMechanismObservations` walks the REGISTRY and reports on mechanisms someone remembered to add. That can
 * never find an omission. This walks the DATA and asks what nobody registered — and on its first live run the two
 * answers sat one line apart: **5 of 45 registry entries demonstrably firing, and 20 categories firing that no
 * audit could judge.** The registry was watching mechanisms that do not run while blind to ones that run
 * constantly.
 */

describe("auditObservationCoverage", () => {
	it("flags a recorded category that is neither registered nor operational", () => {
		const report = auditObservationCoverage(["totally_new_thing"]);
		expect(report.uncovered).toEqual(["totally_new_thing"]);
		expect(report.summary).toMatch(/no audit can judge/u);
	});

	it("does NOT flag a registered mechanism", () => {
		const registered = MECHANISM_REGISTRY[0]?.category as string;
		expect(auditObservationCoverage([registered]).uncovered).toEqual([]);
	});

	it("does NOT flag a category declared OPERATIONAL", () => {
		// Without this escape hatch every sandbox disposal and lane change reads as an unregistered mechanism,
		// and the actionable list drowns — the cries-wolf failure that makes a check get ignored.
		const operational = OPERATIONAL_OBSERVATION_CATEGORIES[0] as string;
		expect(auditObservationCoverage([operational]).uncovered).toEqual([]);
	});

	it("keeps the operational list DISJOINT from the registry", () => {
		// A category in both would be simultaneously judged and excused; whichever check ran first would win.
		const registered = new Set(MECHANISM_REGISTRY.map((entry) => entry.category));
		for (const category of OPERATIONAL_OBSERVATION_CATEGORIES) {
			expect(registered.has(category), `${category} is both registered and declared operational`).toBe(false);
		}
	});

	it("dedupes and sorts, so the count is of distinct categories", () => {
		const report = auditObservationCoverage(["b_thing", "a_thing", "b_thing"]);
		expect(report.recorded).toBe(2);
		expect(report.uncovered).toEqual(["a_thing", "b_thing"]);
	});

	it("says plainly that no recorded categories prove nothing", () => {
		expect(auditObservationCoverage([]).summary).toMatch(/says nothing about coverage/u);
	});

	it("reports a clean result without the alarming clause", () => {
		const registered = MECHANISM_REGISTRY[0]?.category as string;
		expect(auditObservationCoverage([registered]).summary).not.toMatch(/no audit can judge/u);
	});
});
