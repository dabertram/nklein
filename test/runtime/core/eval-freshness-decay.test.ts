import { describe, expect, it } from "vitest";
import {
	buildEvalCellVersionSignature,
	type EvalCellFreshnessInput,
	rankEvalCellsForReevaluation,
	scoreEvalCellReevaluationPriority,
} from "../../../src/core/eval-freshness-decay.js";

/** F3.26 — eval-cell freshness/decay + re-evaluation priority. */

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;
const cell = (over: Partial<EvalCellFreshnessInput> = {}): EvalCellFreshnessInput => ({
	cellKey: "m::worker::medium",
	sampleCount: 4,
	lastEvaluatedAt: NOW - DAY,
	recordedVersionSignature: "sig-v1",
	currentVersionSignature: "sig-v1",
	usageCount: 0,
	...over,
});

describe("buildEvalCellVersionSignature", () => {
	it("changes when any version dimension changes", () => {
		const base = { modelId: "m", quant: "4bit", engine: "mlx", promptVersion: "p1", runtimeVersion: "r1" };
		const sig = buildEvalCellVersionSignature(base);
		expect(buildEvalCellVersionSignature({ ...base, quant: "8bit" })).not.toBe(sig);
		expect(buildEvalCellVersionSignature({ ...base, engine: "llamacpp" })).not.toBe(sig);
		expect(buildEvalCellVersionSignature({ ...base })).toBe(sig); // stable
	});
});

describe("scoreEvalCellReevaluationPriority", () => {
	it("a never-measured cell is maximally stale", () => {
		const s = scoreEvalCellReevaluationPriority(cell({ sampleCount: 0, lastEvaluatedAt: null }), undefined, NOW);
		expect(s.reasons).toContain("never measured");
		expect(s.priority).toBeGreaterThan(0.4);
	});

	it("a version mismatch forces stale-by-version regardless of recency", () => {
		const s = scoreEvalCellReevaluationPriority(
			cell({ lastEvaluatedAt: NOW, recordedVersionSignature: "sig-v1", currentVersionSignature: "sig-v2" }),
			undefined,
			NOW,
		);
		expect(s.staleByVersion).toBe(true);
		expect(s.reasons.some((r) => r.includes("stale by version"))).toBe(true);
	});

	it("a fresh, settled, unused cell has low priority", () => {
		const s = scoreEvalCellReevaluationPriority(
			cell({ sampleCount: 8, lastEvaluatedAt: NOW, usageCount: 0 }),
			undefined,
			NOW,
		);
		expect(s.priority).toBeLessThan(0.15);
	});

	it("age and thin-ness and impact each raise priority", () => {
		const fresh = scoreEvalCellReevaluationPriority(cell({ lastEvaluatedAt: NOW }), undefined, NOW).priority;
		const aged = scoreEvalCellReevaluationPriority(
			cell({ lastEvaluatedAt: NOW - 60 * DAY }),
			undefined,
			NOW,
		).priority;
		const thin = scoreEvalCellReevaluationPriority(cell({ sampleCount: 1 }), undefined, NOW).priority;
		const used = scoreEvalCellReevaluationPriority(cell({ usageCount: 20 }), undefined, NOW).priority;
		expect(aged).toBeGreaterThan(fresh);
		expect(thin).toBeGreaterThan(fresh);
		expect(used).toBeGreaterThan(fresh);
	});
});

describe("rankEvalCellsForReevaluation", () => {
	it("puts the most stale/uncertain/high-impact cells first, stable on ties", () => {
		const ranked = rankEvalCellsForReevaluation(
			[
				cell({ cellKey: "settled", sampleCount: 8, lastEvaluatedAt: NOW, usageCount: 0 }),
				cell({ cellKey: "never", sampleCount: 0, lastEvaluatedAt: null, usageCount: 15 }),
				cell({ cellKey: "aged-thin", sampleCount: 1, lastEvaluatedAt: NOW - 90 * DAY, usageCount: 5 }),
			],
			undefined,
			NOW,
		);
		expect(ranked[0].cellKey === "never" || ranked[0].cellKey === "aged-thin").toBe(true);
		expect(ranked[ranked.length - 1].cellKey).toBe("settled");
	});
});
