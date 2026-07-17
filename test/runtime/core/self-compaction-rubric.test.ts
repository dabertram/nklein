import { describe, expect, it } from "vitest";
import { decideSelfCompaction } from "../../../src/core/self-compaction-rubric";

describe("decideSelfCompaction (F12.6)", () => {
	it("fires when a sub-task resolved — the canonical safe moment", () => {
		const verdict = decideSelfCompaction({
			subTaskResolved: true,
			midDerivation: false,
			stuck: false,
			occupancyFraction: 0.6,
		});
		expect(verdict.action).toBe("fire");
		expect(verdict.reason).toContain("dead weight");
	});

	it("holds mid-derivation and while stuck EVEN when a sub-task claims resolved (unsafe states win)", () => {
		expect(
			decideSelfCompaction({ subTaskResolved: true, midDerivation: true, stuck: false, occupancyFraction: 0.9 })
				.action,
		).toBe("hold");
		const stuck = decideSelfCompaction({
			subTaskResolved: true,
			midDerivation: false,
			stuck: true,
			occupancyFraction: 0.9,
		});
		expect(stuck.action).toBe("hold");
		expect(stuck.reason).toContain("evidence");
	});

	it("holds a bare request at comfortable occupancy, fires at high occupancy", () => {
		expect(
			decideSelfCompaction({ subTaskResolved: false, midDerivation: false, stuck: false, occupancyFraction: 0.4 })
				.action,
		).toBe("hold");
		expect(
			decideSelfCompaction({ subTaskResolved: false, midDerivation: false, stuck: false, occupancyFraction: 0.8 })
				.action,
		).toBe("fire");
		// Unknown occupancy on a bare request stays conservative.
		expect(
			decideSelfCompaction({ subTaskResolved: false, midDerivation: false, stuck: false, occupancyFraction: null })
				.action,
		).toBe("hold");
	});
});
