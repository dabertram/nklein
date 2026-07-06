import { describe, expect, it } from "vitest";
import {
	ADAPTIVE_RETRY_MAX_ATTEMPTS,
	hasStallEvidence,
	shouldAttemptAdaptiveBudgetRetry,
} from "../../../src/nklein-agent/nklein-adaptive-retry-policy";

const base = {
	adaptiveRetryEnabled: true,
	summaryState: "awaiting_review",
	providerId: "p",
	modelId: "m",
	isHomeAgentSession: false,
	attempt: 0,
};

describe("shouldAttemptAdaptiveBudgetRetry (§5.U extraction)", () => {
	it("is eligible when the feature is on, awaiting review, provider+model set, not home-agent, attempts left", () => {
		expect(shouldAttemptAdaptiveBudgetRetry(base)).toBe(true);
	});

	it("is ineligible when disabled or not awaiting review", () => {
		expect(shouldAttemptAdaptiveBudgetRetry({ ...base, adaptiveRetryEnabled: false })).toBe(false);
		expect(shouldAttemptAdaptiveBudgetRetry({ ...base, summaryState: "running" })).toBe(false);
	});

	it("is ineligible without a concrete provider/model or for the home-agent session", () => {
		expect(shouldAttemptAdaptiveBudgetRetry({ ...base, providerId: null })).toBe(false);
		expect(shouldAttemptAdaptiveBudgetRetry({ ...base, modelId: null })).toBe(false);
		expect(shouldAttemptAdaptiveBudgetRetry({ ...base, isHomeAgentSession: true })).toBe(false);
	});

	it("is ineligible once the attempt budget is exhausted", () => {
		expect(shouldAttemptAdaptiveBudgetRetry({ ...base, attempt: ADAPTIVE_RETRY_MAX_ATTEMPTS - 1 })).toBe(true);
		expect(shouldAttemptAdaptiveBudgetRetry({ ...base, attempt: ADAPTIVE_RETRY_MAX_ATTEMPTS })).toBe(false);
		expect(shouldAttemptAdaptiveBudgetRetry({ ...base, attempt: 1, maxAttempts: 1 })).toBe(false);
	});
});

describe("hasStallEvidence (§5.U extraction)", () => {
	it("detects a model_stalled event (by signal or metadata.category) at/after sinceMs", () => {
		expect(hasStallEvidence([{ createdAt: 100, signal: "model_stalled" }], 50)).toBe(true);
		expect(hasStallEvidence([{ createdAt: 100, metadata: { category: "model_stalled" } }], 50)).toBe(true);
	});

	it("ignores stall events from before the run started", () => {
		expect(hasStallEvidence([{ createdAt: 40, signal: "model_stalled" }], 50)).toBe(false);
	});

	it("is false when there is no stall evidence", () => {
		expect(hasStallEvidence([{ createdAt: 100, signal: "tool_argument_error" }], 50)).toBe(false);
		expect(hasStallEvidence([], 50)).toBe(false);
	});
});
