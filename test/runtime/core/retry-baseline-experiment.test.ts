import { describe, expect, test } from "vitest";
import {
	buildRetryBaselineCard,
	RETRY_BASELINE_TEMPERATURES,
	type RetryBaselineObservation,
	summarizeRetryBaseline,
} from "../../../src/core/retry-baseline-experiment.js";

const options = { modelId: "local/model", contextTokens: 32_768, maxTokens: 512 };

describe("retry baseline experiment", () => {
	test("publishes complete equal-budget cards whose only difference is execution", () => {
		const fixed = buildRetryBaselineCard("fixed_retry", options);
		const ramp = buildRetryBaselineCard("temperature_ramp", options);
		const summary = summarizeRetryBaseline([], {
			taskIds: [],
			passBar: 0.6,
			fixedCard: fixed,
			rampCard: ramp,
		});

		expect(fixed.retryBudget).toBe(2);
		expect(ramp.retryBudget).toBe(2);
		expect(summary.cardsComplete).toBe(true);
		expect(summary.comparison).toMatchObject({ verdict: "confounded", differing: ["execution"] });
	});

	test("pins the trivial ramp and fixed control schedules", () => {
		expect(RETRY_BASELINE_TEMPERATURES).toEqual({
			fixed_retry: [0, 0, 0],
			temperature_ramp: [0, 0.2, 0.4],
		});
	});

	test("uses the best attempt, reports paired flips, and separates missing answers", () => {
		const rows: RetryBaselineObservation[] = [
			{ taskId: "a", arm: "fixed_retry", attempt: 1, temperature: 0, score: 0.4, latencyMs: 10, failureKind: null },
			{ taskId: "a", arm: "fixed_retry", attempt: 2, temperature: 0, score: 0.8, latencyMs: 10, failureKind: null },
			{
				taskId: "a",
				arm: "temperature_ramp",
				attempt: 1,
				temperature: 0,
				score: 0.4,
				latencyMs: 10,
				failureKind: null,
			},
			{
				taskId: "a",
				arm: "temperature_ramp",
				attempt: 2,
				temperature: 0.2,
				score: null,
				latencyMs: 10,
				failureKind: "unscorable",
			},
			{ taskId: "b", arm: "fixed_retry", attempt: 1, temperature: 0, score: 0.2, latencyMs: 10, failureKind: null },
			{
				taskId: "b",
				arm: "temperature_ramp",
				attempt: 1,
				temperature: 0,
				score: 1,
				latencyMs: 10,
				failureKind: null,
			},
		];
		const fixedCard = buildRetryBaselineCard("fixed_retry", options);
		const rampCard = buildRetryBaselineCard("temperature_ramp", options);
		const summary = summarizeRetryBaseline(rows, {
			taskIds: ["a", "b"],
			passBar: 0.6,
			fixedCard,
			rampCard,
		});

		expect(summary).toMatchObject({
			taskCount: 2,
			expectedAttempts: 12,
			observationCount: 6,
			infraErrorCount: 0,
			unscorableCount: 1,
			fixedPassRate: 0.5,
			rampPassRate: 0.5,
			pairedDelta: 0,
			fixedOnlyPasses: 1,
			rampOnlyPasses: 1,
			claim: "descriptive_baseline_only",
		});
	});

	test("an empty corpus stays finite and explicitly descriptive", () => {
		const fixedCard = buildRetryBaselineCard("fixed_retry", options);
		const rampCard = buildRetryBaselineCard("temperature_ramp", options);
		const summary = summarizeRetryBaseline([], { taskIds: [], passBar: 0.6, fixedCard, rampCard });
		expect(summary.fixedPassRate).toBe(0);
		expect(summary.rampPassRate).toBe(0);
		expect(summary.pairedDelta).toBe(0);
		expect(summary.claim).toBe("descriptive_baseline_only");
	});
});
