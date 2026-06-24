import { describe, expect, it } from "vitest";
import type { NKleinModelRegistryEntry } from "../../../src/nklein-sdk/nklein-model-registry";
import { routeNKleinTask } from "../../../src/nklein-sdk/nklein-task-router";

function createEntry(input: {
	key: string;
	capability: number;
	contextWindow: number;
	prefillTokensPerSecond?: number | null;
	decodeTokensPerSecond?: number | null;
}): NKleinModelRegistryEntry {
	const [providerId = "provider", modelId = input.key, endpoint = "default"] = input.key.split(":");
	return {
		key: input.key,
		providerId,
		modelId,
		endpoint,
		contextWindow: {
			advertised: input.contextWindow,
			observed: null,
			userOverride: null,
			effective: input.contextWindow,
		},
		speed: {
			samples: 1,
			promptTokensEwma: null,
			outputTokensEwma: null,
			totalTokensEwma: null,
			prefillTokensPerSecondEwma: input.prefillTokensPerSecond ?? null,
			decodeTokensPerSecondEwma: input.decodeTokensPerSecond ?? null,
			ttftMsEwma: null,
			wallTimeMsEwma: null,
			wallTimeMsPer1kPromptTokensEwma: null,
			lastPromptTokens: null,
			lastOutputTokens: null,
			lastWallTimeMs: null,
			lastObservedAt: null,
		},
		capability: {
			samples: 1,
			staticPrior: input.capability,
			evalScore: null,
			externalScore: null,
			observedPassRate: null,
			effectiveScore: input.capability,
			lastObservedAt: null,
		},
		constraints: {
			sharedEndpointId: endpoint,
			inputCostPerMillionTokens: null,
			outputCostPerMillionTokens: null,
			maxConcurrentRequests: null,
		},
		createdAt: 1,
		updatedAt: 1,
	};
}

describe("routeNKleinTask", () => {
	it("assigns the smallest sufficient model", () => {
		const decision = routeNKleinTask({
			difficulty: 40,
			fitBudgetTokens: 8_000,
			candidates: [
				{
					entry: createEntry({ key: "ollama:small:default", capability: 45, contextWindow: 16_000 }),
					role: "worker",
				},
				{
					entry: createEntry({ key: "openrouter:large:default", capability: 90, contextWindow: 200_000 }),
					role: "architect",
				},
			],
		});

		expect(decision).toMatchObject({
			type: "assign",
			modelKey: "ollama:small:default",
			role: "worker",
		});
	});

	it("keeps a feasible preferred local model instead of routing down to a smaller sufficient model", () => {
		const decision = routeNKleinTask({
			difficulty: 40,
			fitBudgetTokens: 8_000,
			preferredModelKey: "ollama:large:default",
			candidates: [
				{
					entry: createEntry({ key: "ollama:small:default", capability: 45, contextWindow: 32_000 }),
					role: "worker",
				},
				{
					entry: createEntry({ key: "ollama:large:default", capability: 85, contextWindow: 80_000 }),
					role: "architect",
				},
			],
		});

		expect(decision).toMatchObject({
			type: "assign",
			modelKey: "ollama:large:default",
			role: "architect",
			reason: expect.stringContaining("preferred model"),
		});
	});

	it("routes away from a preferred local model that cannot fit the required window", () => {
		const decision = routeNKleinTask({
			difficulty: 40,
			fitBudgetTokens: 60_000,
			preferredModelKey: "ollama:small:default",
			candidates: [
				{
					entry: createEntry({ key: "ollama:small:default", capability: 55, contextWindow: 16_000 }),
					role: "worker",
				},
				{
					entry: createEntry({ key: "lmstudio:wide:default", capability: 60, contextWindow: 80_000 }),
					role: "architect",
				},
			],
		});

		expect(decision).toMatchObject({
			type: "route_up",
			modelKey: "lmstudio:wide:default",
			fromModelKey: "ollama:small:default",
			reason: expect.stringContaining("does not fit the required capability/window"),
		});
	});

	it("decomposes instead of routing up into a cloud candidate", () => {
		const decision = routeNKleinTask({
			difficulty: 70,
			fitBudgetTokens: 12_000,
			preferredModelKey: "ollama:small:default",
			candidates: [
				{
					entry: createEntry({ key: "ollama:small:default", capability: 45, contextWindow: 16_000 }),
					role: "worker",
				},
				{
					entry: createEntry({ key: "openrouter:large:default", capability: 90, contextWindow: 200_000 }),
					role: "architect",
				},
			],
		});

		expect(decision).toMatchObject({
			type: "decompose",
			requiredCapability: 70,
			requiredContextWindow: 12_000,
		});
	});

	it("drops a cloud preferred model and assigns the smallest local fit", () => {
		const decision = routeNKleinTask({
			difficulty: 40,
			fitBudgetTokens: 8_000,
			preferredModelKey: "openrouter:large:default",
			candidates: [
				{
					entry: createEntry({ key: "ollama:small:default", capability: 45, contextWindow: 16_000 }),
					role: "worker",
				},
				{
					entry: createEntry({ key: "openrouter:large:default", capability: 90, contextWindow: 200_000 }),
					role: "architect",
				},
			],
		});

		expect(decision).toMatchObject({
			type: "assign",
			modelKey: "ollama:small:default",
			role: "worker",
		});
	});

	it("can assign an 8k model when the prompt fits that candidate's own reserves", () => {
		const decision = routeNKleinTask({
			difficulty: 35,
			fitBudgetTokens: 80_000,
			promptTokens: 1_000,
			candidates: [
				{
					entry: createEntry({ key: "ollama:tiny:default", capability: 45, contextWindow: 8_000 }),
					role: "worker",
				},
				{
					entry: createEntry({ key: "openrouter:large:default", capability: 90, contextWindow: 200_000 }),
					role: "architect",
				},
			],
		});

		expect(decision).toMatchObject({
			type: "assign",
			modelKey: "ollama:tiny:default",
		});
	});

	it("uses each local candidate's own context window when assigning 32k versus 80k models", () => {
		const decision = routeNKleinTask({
			difficulty: 35,
			fitBudgetTokens: 80_000,
			promptTokens: 30_000,
			candidates: [
				{
					entry: createEntry({ key: "ollama:ctx32k:default", capability: 45, contextWindow: 32_000 }),
					role: "worker",
				},
				{
					entry: createEntry({ key: "ollama:ctx80k:default", capability: 45, contextWindow: 80_000 }),
					role: "worker",
				},
			],
		});

		expect(decision).toMatchObject({
			type: "assign",
			modelKey: "ollama:ctx80k:default",
		});
	});

	it("uses predicted speed as a tie-breaker after capability and cost", () => {
		const decision = routeNKleinTask({
			difficulty: 50,
			fitBudgetTokens: 8_000,
			promptTokens: 4_000,
			outputTokens: 400,
			candidates: [
				{
					entry: createEntry({
						key: "ollama:slow:default",
						capability: 60,
						contextWindow: 16_000,
						prefillTokensPerSecond: 500,
						decodeTokensPerSecond: 20,
					}),
					costRank: 1,
				},
				{
					entry: createEntry({
						key: "ollama:fast:default",
						capability: 60,
						contextWindow: 16_000,
						prefillTokensPerSecond: 2_000,
						decodeTokensPerSecond: 100,
					}),
					costRank: 1,
				},
			],
		});

		expect(decision).toMatchObject({
			type: "assign",
			modelKey: "ollama:fast:default",
		});
	});

	it("decomposes when no model satisfies both capability and context", () => {
		const decision = routeNKleinTask({
			difficulty: 70,
			fitBudgetTokens: 80_000,
			candidates: [
				{ entry: createEntry({ key: "ollama:smart-small-window:default", capability: 80, contextWindow: 16_000 }) },
				{ entry: createEntry({ key: "openrouter:large-weak:default", capability: 40, contextWindow: 200_000 }) },
			],
		});

		expect(decision).toMatchObject({
			type: "decompose",
			requiredCapability: 70,
			requiredContextWindow: 80_000,
		});
	});

	it("escalates when no connected model is capable or large enough", () => {
		const decision = routeNKleinTask({
			difficulty: 90,
			fitBudgetTokens: 200_000,
			candidates: [
				{ entry: createEntry({ key: "ollama:small:default", capability: 45, contextWindow: 16_000 }) },
				{ entry: createEntry({ key: "openrouter:mid:default", capability: 70, contextWindow: 80_000 }) },
			],
		});

		expect(decision).toMatchObject({
			type: "escalate",
			requiredCapability: 90,
			requiredContextWindow: 200_000,
		});
	});
});
