import { describe, expect, it } from "vitest";
import type { NKleinModelRegistrySnapshot } from "../../../src/nklein-sdk/nklein-model-registry";
import {
	applyMcsrAwareLocalTimeoutScaling,
	type NKleinTimeoutSettings,
} from "../../../src/nklein-sdk/nklein-timeout-scaling";

const BASE_TIMEOUTS: NKleinTimeoutSettings = {
	timeoutMode: "normal",
	requestTimeoutMs: 60_000,
	streamTimeoutMs: 60_000,
	toolTimeoutMs: 60_000,
	agentTimeoutMs: 60_000,
	conversationTimeoutMs: 60_000,
	timeoutProfile: "local",
};

function createSnapshot(contextWindow: number, samples: number): NKleinModelRegistrySnapshot {
	return {
		schemaVersion: 1,
		updatedAt: 1,
		models: {
			"lmstudio:qwen:http://localhost:1234/v1": {
				key: "lmstudio:qwen:http://localhost:1234/v1",
				providerId: "lmstudio",
				modelId: "qwen",
				endpoint: "http://localhost:1234/v1",
				contextWindow: {
					advertised: contextWindow,
					observed: null,
					userOverride: null,
					effective: contextWindow,
				},
				speed: {
					samples,
					promptTokensEwma: null,
					outputTokensEwma: null,
					totalTokensEwma: null,
					prefillTokensPerSecondEwma: null,
					decodeTokensPerSecondEwma: null,
					ttftMsEwma: null,
					wallTimeMsEwma: null,
					wallTimeMsPer1kPromptTokensEwma: null,
					lastPromptTokens: null,
					lastOutputTokens: null,
					lastWallTimeMs: null,
					lastObservedAt: null,
				},
				capability: {
					samples: 0,
					staticPrior: 70,
					evalScore: null,
					externalScore: null,
					observedPassRate: null,
					effectiveScore: 70,
					lastObservedAt: null,
				},
				constraints: {
					sharedEndpointId: "lmstudio:http://localhost:1234/v1",
					inputCostPerMillionTokens: null,
					outputCostPerMillionTokens: null,
				},
				createdAt: 1,
				updatedAt: 1,
			},
		},
	};
}

describe("applyMcsrAwareLocalTimeoutScaling", () => {
	it("raises positive local timeouts on cold start from the effective context window", () => {
		const scaled = applyMcsrAwareLocalTimeoutScaling({
			timeouts: BASE_TIMEOUTS,
			launchConfig: {
				providerId: "lmstudio",
				modelId: "qwen",
				baseUrl: "http://localhost:1234/v1",
			},
			modelRegistry: createSnapshot(1_000_000, 0),
			promptTokens: 32_000,
		});

		expect(scaled.requestTimeoutMs).toBeGreaterThan(BASE_TIMEOUTS.requestTimeoutMs ?? 0);
		expect(scaled.streamTimeoutMs).toBe(scaled.requestTimeoutMs);
		expect(scaled.toolTimeoutMs).toBe(scaled.requestTimeoutMs);
		expect(scaled.agentTimeoutMs).toBe(scaled.requestTimeoutMs);
		expect(scaled.conversationTimeoutMs).toBe(scaled.requestTimeoutMs);
	});

	it("does not alter unlimited timeouts", () => {
		const unlimited = {
			...BASE_TIMEOUTS,
			timeoutMode: "unlimited" as const,
			requestTimeoutMs: null,
			streamTimeoutMs: null,
			toolTimeoutMs: null,
			agentTimeoutMs: null,
			conversationTimeoutMs: null,
		};

		expect(
			applyMcsrAwareLocalTimeoutScaling({
				timeouts: unlimited,
				launchConfig: {
					providerId: "lmstudio",
					modelId: "qwen",
					baseUrl: "http://localhost:1234/v1",
				},
				modelRegistry: createSnapshot(1_000_000, 0),
				promptTokens: 32_000,
			}),
		).toEqual(unlimited);
	});
});
