import { describe, expect, it } from "vitest";
import type { NKleinModelRegistrySnapshot } from "../../../src/nklein-agent/nklein-model-registry";
import {
	buildNKleinModelFreshnessAdvisorRequest,
	buildPrimaryModelResearchQueries,
	isPrimaryModelSourceUrl,
	resolvePrimaryModelSourcePolicy,
	runNKleinModelResearch,
	summarizeNKleinModelRegistryForResearch,
} from "../../../src/nklein-agent/nklein-model-research";

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
					maxConcurrentRequests: null,
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

	it("admits only publisher-primary paths instead of whole aggregator hosts", () => {
		const policy = resolvePrimaryModelSourcePolicy("qwen/qwen3.6-35b-a3b");
		expect(policy).not.toBeNull();
		if (!policy) return;
		expect(buildPrimaryModelResearchQueries("qwen/qwen3.6-35b-a3b", policy)).toHaveLength(5);
		expect(isPrimaryModelSourceUrl("https://qwenlm.github.io/blog/qwen3", policy)).toBe(true);
		expect(isPrimaryModelSourceUrl("https://github.com/QwenLM/Qwen3", policy)).toBe(true);
		expect(isPrimaryModelSourceUrl("https://github.com/random-user/qwen-notes", policy)).toBe(false);
		expect(isPrimaryModelSourceUrl("https://huggingface.co/Qwen/Qwen3", policy)).toBe(true);
		expect(isPrimaryModelSourceUrl("https://huggingface.co/random-user/Qwen3", policy)).toBe(false);
		expect(isPrimaryModelSourceUrl("https://openrouter.ai/models/qwen3", policy)).toBe(false);
		expect(isPrimaryModelSourceUrl("http://qwenlm.github.io/blog/qwen3", policy)).toBe(false);
	});

	it.each([
		{
			name: "egress is off",
			egressEnabled: false,
			searchBackendUrl: "http://127.0.0.1:8888",
			airGapped: false,
			error: "egress is disabled",
		},
		{
			name: "the search backend is absent",
			egressEnabled: true,
			searchBackendUrl: null,
			airGapped: false,
			error: "configured SearXNG",
		},
		{
			name: "air-gap mode is active",
			egressEnabled: true,
			searchBackendUrl: "http://127.0.0.1:8888",
			airGapped: true,
			error: "air-gap mode",
		},
	])("does no search when $name", async ({ egressEnabled, searchBackendUrl, airGapped, error }) => {
		let searches = 0;
		await expect(
			runNKleinModelResearch(
				{
					targetProviderId: "lmstudio",
					targetModelId: "qwen/qwen3.6-35b-a3b",
					advisorProviderId: "lmstudio",
					advisorModelId: "reviewer",
					egressEnabled,
					searchBackendUrl,
					airGapped,
				},
				{
					search: async () => {
						searches += 1;
						return { query: "unused", results: [] };
					},
					complete: async () => "{}",
				},
			),
		).rejects.toThrow(error);
		expect(searches).toBe(0);
	});

	it("returns a bounded, cited, review-only proposal and drops fabricated citations", async () => {
		let searches = 0;
		let fetches = 0;
		let synthesisPrompt = "";
		const response = await runNKleinModelResearch(
			{
				targetProviderId: "lmstudio",
				targetModelId: "qwen/qwen3.6-35b-a3b",
				targetEndpoint: "http://localhost:1234/v1",
				failureSummary: "narrated a call instead of emitting one",
				advisorProviderId: "lmstudio",
				advisorModelId: "google/gemma-4-31b-qat",
				egressEnabled: true,
				searchBackendUrl: "http://127.0.0.1:8888",
				airGapped: false,
			},
			{
				search: async (query) => {
					searches += 1;
					return {
						query,
						results: [
							{
								title: "Qwen official model card",
								url: "https://huggingface.co/Qwen/Qwen3.6-35B-A3B",
								snippet: "official",
							},
							{
								title: "Secondary ranking",
								url: "https://openrouter.ai/models/qwen3",
								snippet: "secondary",
							},
						],
					};
				},
				fetchPage: async (url) => {
					fetches += 1;
					return {
						url,
						title: "Qwen3.6 official model card",
						text: "The model supports native tool calling and is intended for agentic coding.",
					};
				},
				complete: async (prompt) => {
					synthesisPrompt = prompt;
					return JSON.stringify({
						toolUse: { value: "TOOL_NATIVE", sourceIds: ["S1"] },
						kind: { value: "agentic", sourceIds: ["FAKE"] },
						chaining: null,
						structuredOutput: { value: "native_tool_call", sourceIds: ["S1"] },
						findings: [
							{ area: "tool_dialect", claim: "Uses native tool calls.", sourceIds: ["S1"] },
							{ area: "reasoning_controls", claim: "Imaginary switch.", sourceIds: ["FAKE"] },
						],
						unknowns: ["Exact quant-specific context degradation"],
						warnings: [],
					});
				},
				now: () => 123,
			},
		);

		expect(searches).toBe(5);
		expect(fetches).toBe(1);
		expect(synthesisPrompt).toContain("Observed failure context (not evidence)");
		expect(response).toMatchObject({
			status: "provisional",
			researchedAt: 123,
			autoApplied: false,
			proposal: {
				toolUse: { value: "TOOL_NATIVE", sourceIds: ["S1"] },
				kind: null,
				structuredOutput: { value: "native_tool_call", sourceIds: ["S1"] },
				basis: "research",
				verified: false,
			},
		});
		expect(response.proposal.findings).toEqual([
			{ area: "tool_dialect", claim: "Uses native tool calls.", sourceIds: ["S1"] },
		]);
		expect(response.proposal.warnings.join(" ")).toContain("kind was omitted");
		expect(response.proposal.warnings.join(" ")).toContain("reasoning_controls finding was omitted");
		expect(response.proposal.sources).toEqual(["https://huggingface.co/Qwen/Qwen3.6-35B-A3B"]);
	});

	it("returns an honest empty proposal when primary evidence cannot be retrieved", async () => {
		const response = await runNKleinModelResearch(
			{
				targetProviderId: "lmstudio",
				targetModelId: "google/gemma-4-31b-qat",
				advisorProviderId: "lmstudio",
				advisorModelId: "reviewer",
				egressEnabled: true,
				searchBackendUrl: "http://127.0.0.1:8888",
				airGapped: false,
			},
			{
				search: async (query) => ({ query, results: [] }),
				complete: async () => {
					throw new Error("must not synthesize without evidence");
				},
			},
		);
		expect(response.proposal.toolUse).toBeNull();
		expect(response.proposal.sources).toEqual([]);
		expect(response.proposal.warnings[0]).toContain("No current primary-source pages");
		expect(response.autoApplied).toBe(false);
	});
});
