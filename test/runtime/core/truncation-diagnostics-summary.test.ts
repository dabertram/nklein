import { describe, expect, it } from "vitest";
import {
	buildTruncationObservation,
	summarizeTruncationDiagnostics,
} from "../../../src/core/truncation-diagnostics-summary";
import type { StoredTruncationObservation } from "../../../src/state/truncation-observation-store";

const base = { modelId: "m", surface: "chat", role: "worker" };

describe("buildTruncationObservation (F4.12)", () => {
	it("returns null when the completion did not hit a length limit (nothing to record)", () => {
		expect(
			buildTruncationObservation({
				...base,
				hitLengthLimit: false,
				reasoningTokens: 10,
				answerTokens: 10,
				reasoningBudget: 100,
				answerBudget: 100,
			}),
		).toBeNull();
	});

	it("records reasoning_starved_answer when reasoning ate its budget but the answer didn't", () => {
		const obs = buildTruncationObservation({
			...base,
			hitLengthLimit: true,
			reasoningTokens: 98,
			answerTokens: 5,
			reasoningBudget: 100,
			answerBudget: 100,
		});
		expect(obs?.cause).toBe("reasoning_starved_answer");
		expect(obs?.modelId).toBe("m");
	});

	it("records answer_budget when the answer hit its cap", () => {
		const obs = buildTruncationObservation({
			...base,
			hitLengthLimit: true,
			reasoningTokens: 0,
			answerTokens: 100,
			reasoningBudget: 0,
			answerBudget: 100,
		});
		expect(obs?.cause).toBe("answer_budget");
	});
});

describe("summarizeTruncationDiagnostics (F4.12)", () => {
	const mk = (modelId: string, cause: StoredTruncationObservation["cause"]): StoredTruncationObservation => ({
		modelId,
		surface: "chat",
		role: "worker",
		cause,
		reasoningTokens: 0,
		answerTokens: 0,
		reasoningBudget: 0,
		answerBudget: 0,
	});

	it("aggregates per model, worst-first, with the dominant-cause remediation", () => {
		const summary = summarizeTruncationDiagnostics([
			mk("big-reasoner", "reasoning_starved_answer"),
			mk("big-reasoner", "reasoning_starved_answer"),
			mk("big-reasoner", "answer_budget"),
			mk("chatty", "answer_budget"),
		]);
		expect(summary.map((s) => s.modelId)).toEqual(["big-reasoner", "chatty"]); // 3 > 1
		expect(summary[0]?.dominantCause).toBe("reasoning_starved_answer");
		expect(summary[0]?.byCause.reasoning_starved_answer).toBe(2);
		expect(summary[0]?.recommendation).toContain("reasoning reserve");
		expect(summary[1]?.recommendation).toContain("answer budget");
	});

	it("returns [] for no observations", () => {
		expect(summarizeTruncationDiagnostics([])).toEqual([]);
	});
});
