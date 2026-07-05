import { describe, expect, it } from "vitest";
import {
	applyCalibration,
	combineConfidenceEvidence,
	scoreCalibratedConfidence,
} from "../../../src/core/confidence-scorer";

describe("combineConfidenceEvidence", () => {
	it("all signals high ⇒ high confidence; all low ⇒ low", () => {
		expect(
			combineConfidenceEvidence({ toolCallValidity: 1, testPassRate: 1, reviewerVerdict: 1, selfConsistency: 1 }),
		).toBe(1);
		expect(
			combineConfidenceEvidence({ toolCallValidity: 0, testPassRate: 0, reviewerVerdict: 0, selfConsistency: 0 }),
		).toBe(0);
	});

	it("no evidence ⇒ 0.5 (unknown)", () => {
		expect(combineConfidenceEvidence({})).toBe(0.5);
	});

	it("renormalizes over present signals (a single passing-tests signal ⇒ that value, not diluted toward 0)", () => {
		expect(combineConfidenceEvidence({ testPassRate: 0.9 })).toBeCloseTo(0.9, 10);
	});

	it("test pass + reviewer verdict dominate tool validity", () => {
		const strong = combineConfidenceEvidence({ testPassRate: 1, reviewerVerdict: 1, toolCallValidity: 0 });
		const weak = combineConfidenceEvidence({ testPassRate: 0, reviewerVerdict: 0, toolCallValidity: 1 });
		expect(strong).toBeGreaterThan(0.7);
		expect(weak).toBeLessThan(0.3);
	});

	it("clamps out-of-range signals", () => {
		expect(combineConfidenceEvidence({ testPassRate: 5 })).toBe(1);
		expect(combineConfidenceEvidence({ testPassRate: -5 })).toBe(0);
	});
});

describe("applyCalibration", () => {
	it("empty curve ⇒ identity", () => {
		expect(applyCalibration(0.7)).toBe(0.7);
		expect(applyCalibration(0.7, { points: [] })).toBe(0.7);
	});

	it("corrects overconfidence: raw 0.8 → calibrated 0.6 via interpolation", () => {
		const curve = {
			points: [
				{ raw: 0, calibrated: 0 },
				{ raw: 1, calibrated: 0.75 },
			],
		};
		expect(applyCalibration(0.8, curve)).toBeCloseTo(0.6, 10);
	});

	it("clamps to the endpoints outside the anchor range", () => {
		const curve = {
			points: [
				{ raw: 0.2, calibrated: 0.1 },
				{ raw: 0.8, calibrated: 0.9 },
			],
		};
		expect(applyCalibration(0.0, curve)).toBeCloseTo(0.1, 10);
		expect(applyCalibration(1.0, curve)).toBeCloseTo(0.9, 10);
	});

	it("tolerates unsorted anchor points", () => {
		const curve = {
			points: [
				{ raw: 1, calibrated: 0.75 },
				{ raw: 0, calibrated: 0 },
			],
		};
		expect(applyCalibration(0.8, curve)).toBeCloseTo(0.6, 10);
	});
});

describe("scoreCalibratedConfidence", () => {
	it("combines evidence then calibrates", () => {
		const curve = {
			points: [
				{ raw: 0, calibrated: 0 },
				{ raw: 1, calibrated: 0.5 },
			],
		};
		// evidence ⇒ raw 1.0; curve halves it ⇒ 0.5.
		expect(
			scoreCalibratedConfidence(
				{ testPassRate: 1, reviewerVerdict: 1, selfConsistency: 1, toolCallValidity: 1 },
				curve,
			),
		).toBeCloseTo(0.5, 10);
	});
});
