import { describe, expect, it } from "vitest";
import type { NKleinModelRegistrySnapshot } from "../../../src/nklein-sdk/nklein-model-registry";
import {
	buildNKleinModelFreshnessAdvisorRequest,
	summarizeNKleinModelRegistryForResearch,
} from "../../../src/nklein-sdk/nklein-model-research";

function createSnapshot(): NKleinModelRegistrySnapshot {
	return {
		schemaVersion: 1,
		updatedAt: 20,
		models: {
			"ollama:qwen:local": {
				key: "ollama:qwen:local",
				providerId: "ollama",
				modelId: "qwen",
				endpoint: "local",
				contextWindow: {
					advertised: null,
					observed: 16_000,
					userOverride: null,
					effective: 16_000,
				},
				speed: {
					samples: 2,
					promptTokensEwma: 1_000,
					outputTokensEwma: 50,
					totalTokensEwma: 1_050,
					prefillTokensPerSecondEwma: 500,
					decodeTokensPerSecondEwma: 40,
					ttftMsEwma: 500,
					wallTimeMsEwma: 3_000,
					wallTimeMsPer1kPromptTokensEwma: 2_000,
					lastPromptTokens: 1_000,
					lastOutputTokens: 50,
					lastWallTimeMs: 3_000,
					lastObservedAt: 20,
				},
				capability: {
					samples: 1,
					staticPrior: 35,
					evalScore: null,
					externalScore: null,
					observedPassRate: 0.7,
					effectiveScore: 53,
					lastObservedAt: 20,
				},
				constraints: {
					sharedEndpointId: "local-gpu",
					inputCostPerMillionTokens: null,
					outputCostPerMillionTokens: null,
				},
				createdAt: 10,
				updatedAt: 20,
			},
		},
	};
}

describe("nklein model research", () => {
	it("summarizes the model registry for model-freshness research", () => {
		expect(summarizeNKleinModelRegistryForResearch(createSnapshot())).toContain(
			"ollama:qwen (16,000 tokens, 53/100 capability, 2000ms per 1k prompt tokens, endpoint local-gpu)",
		);
	});

	it("builds a model freshness advisor request from the registry", async () => {
		const request = await buildNKleinModelFreshnessAdvisorRequest({
			getSnapshot: async () => createSnapshot(),
		});

		expect(request).toMatchObject({
			kind: "model_freshness",
			requiresWebResearch: true,
		});
		expect(request.prompt).toContain("ollama:qwen");
		expect(request.prompt).toContain("Do not auto-apply changes");
	});
});
