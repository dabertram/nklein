import { describe, expect, it } from "vitest";
import {
	aggregateJury,
	cohenKappa,
	probePositionBias,
	probeSelfEnhancement,
	probeVerbosityBias,
} from "../../src/core/judge-calibration";

describe("cohenKappa (F12.50)", () => {
	it("exposes the pass-heavy inflation raw agreement hides", () => {
		// Judge always says pass on a 90%-pass set: 90% raw agreement, kappa 0 (pure chance).
		const trials = [
			...Array.from({ length: 9 }, () => ({ judgeVerdict: true, humanVerdict: true })),
			{ judgeVerdict: true, humanVerdict: false },
		];
		const report = cohenKappa(trials);
		expect(report.rawAgreement).toBeCloseTo(0.9);
		expect(report.kappa).toBeCloseTo(0);
		expect(report.interpretation).toContain("near-chance");
	});

	it("scores a perfect judge 1 and a constant-marginal set as undefined", () => {
		const perfect = cohenKappa([
			{ judgeVerdict: true, humanVerdict: true },
			{ judgeVerdict: false, humanVerdict: false },
		]);
		expect(perfect.kappa).toBe(1);
		const degenerate = cohenKappa([
			{ judgeVerdict: true, humanVerdict: true },
			{ judgeVerdict: true, humanVerdict: true },
		]);
		expect(degenerate.kappa).toBeNull();
	});
});

describe("bias probes (F12.50)", () => {
	it("flags a judge whose verdict tracks presentation order", () => {
		const report = probePositionBias([
			{ firstOrderWinner: "a", swappedOrderWinner: "b" },
			{ firstOrderWinner: "a", swappedOrderWinner: "b" },
			{ firstOrderWinner: "a", swappedOrderWinner: "a" },
		]);
		expect(report.positionTrackedRate).toBeCloseTo(2 / 3);
		expect(report.biased).toBe(true);
	});

	it("flags length-following verdicts and stays honest on degenerate columns", () => {
		const biased = probeVerbosityBias([
			{ judgeVerdict: true, responseLength: 900 },
			{ judgeVerdict: true, responseLength: 800 },
			{ judgeVerdict: false, responseLength: 100 },
			{ judgeVerdict: false, responseLength: 150 },
		]);
		expect(biased.biased).toBe(true);
		expect(biased.correlation ?? 0).toBeGreaterThan(0.3);
		const constant = probeVerbosityBias([
			{ judgeVerdict: true, responseLength: 500 },
			{ judgeVerdict: true, responseLength: 500 },
		]);
		expect(constant.correlation).toBeNull();
		expect(constant.biased).toBe(false);
	});

	it("flags a judge that favors its own family", () => {
		const report = probeSelfEnhancement([
			{ judgeVerdict: true, ownFamily: true },
			{ judgeVerdict: true, ownFamily: true },
			{ judgeVerdict: true, ownFamily: true },
			{ judgeVerdict: true, ownFamily: false },
			{ judgeVerdict: false, ownFamily: false },
			{ judgeVerdict: false, ownFamily: false },
		]);
		expect(report.gap).toBeCloseTo(1 - 1 / 3);
		expect(report.biased).toBe(true);
	});
});

describe("aggregateJury (F12.50 PoLL)", () => {
	it("majority-votes, flags dissent for human review", () => {
		const split = aggregateJury([
			{ judgeId: "j1", family: "qwen", verdict: true },
			{ judgeId: "j2", family: "gemma", verdict: true },
			{ judgeId: "j3", family: "mistral", verdict: false },
		]);
		expect(split.verdict).toBe(true);
		expect(split.disagreement).toBe(true);
		expect(split.note).toContain("human review");
	});

	it("never calls an empty jury unanimous (review-found)", () => {
		const empty = aggregateJury([]);
		expect(empty.verdict).toBe(false);
		expect(empty.note).toContain("no votes");
	});

	it("caps confidence on a same-family unanimous jury", () => {
		const sameFamily = aggregateJury([
			{ judgeId: "j1", family: "qwen", verdict: true },
			{ judgeId: "j2", family: "qwen", verdict: true },
		]);
		expect(sameFamily.disagreement).toBe(false);
		expect(sameFamily.correlatedFamilies).toBe(true);
		expect(sameFamily.note).toContain("correlated");
	});
});
