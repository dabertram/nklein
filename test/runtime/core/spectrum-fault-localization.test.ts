import { describe, expect, it } from "vitest";
import { ochiaiSuspiciousness, rankSpectrumSuspects } from "../../../src/core/spectrum-fault-localization";

describe("ochiaiSuspiciousness", () => {
	it("an element only failing tests touch is maximally suspicious (1.0)", () => {
		// failed=4, passed=0, totalFailed=4 ⇒ 4/sqrt(4*4) = 1.
		expect(ochiaiSuspiciousness({ ref: "x", failedCovering: 4, passedCovering: 0 }, 4)).toBeCloseTo(1, 10);
	});

	it("an element no failing test touches scores 0 (not the fault)", () => {
		expect(ochiaiSuspiciousness({ ref: "x", failedCovering: 0, passedCovering: 10 }, 5)).toBe(0);
	});

	it("passing coverage dilutes suspiciousness", () => {
		const focused = ochiaiSuspiciousness({ ref: "a", failedCovering: 3, passedCovering: 0 }, 3);
		const shared = ochiaiSuspiciousness({ ref: "b", failedCovering: 3, passedCovering: 12 }, 3);
		expect(focused).toBeGreaterThan(shared);
	});

	it("returns 0 on a degenerate ÷0 (no failing tests at all)", () => {
		expect(ochiaiSuspiciousness({ ref: "x", failedCovering: 0, passedCovering: 0 }, 0)).toBe(0);
	});

	it("clamps negative counts (fail-safe)", () => {
		expect(ochiaiSuspiciousness({ ref: "x", failedCovering: -2, passedCovering: -3 }, -1)).toBe(0);
	});
});

describe("rankSpectrumSuspects", () => {
	it("ranks the fault (all failing, no passing) above shared and above passing-only code", () => {
		const ranked = rankSpectrumSuspects({
			totalFailing: 3,
			totalPassing: 10,
			elements: [
				{ ref: "shared", failedCovering: 3, passedCovering: 8 },
				{ ref: "fault", failedCovering: 3, passedCovering: 0 },
				{ ref: "innocent", failedCovering: 0, passedCovering: 10 },
			],
		});
		expect(ranked.map((r) => r.ref)).toEqual(["fault", "shared", "innocent"]);
		expect(ranked[0]?.suspiciousness).toBeCloseTo(1, 10);
		expect(ranked[2]?.suspiciousness).toBe(0);
	});

	it("is stable on ties (equal suspiciousness keeps input order)", () => {
		const ranked = rankSpectrumSuspects({
			totalFailing: 2,
			totalPassing: 0,
			elements: [
				{ ref: "a", failedCovering: 2, passedCovering: 0 },
				{ ref: "b", failedCovering: 2, passedCovering: 0 },
			],
		});
		expect(ranked.map((r) => r.ref)).toEqual(["a", "b"]);
	});
});
