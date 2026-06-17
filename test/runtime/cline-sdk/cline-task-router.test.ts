import { describe, expect, it } from "vitest";
import type { ClineModelRegistryEntry } from "../../../src/cline-sdk/cline-model-registry";
import { routeClineTask } from "../../../src/cline-sdk/cline-task-router";

function createEntry(input: {
	key: string;
	capability: number;
	contextWindow: number;
	prefillTokensPerSecond?: number | null;
	decodeTokensPerSecond?: number | null;
}): ClineModelRegistryEntry {
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
		},
		createdAt: 1,
		updatedAt: 1,
	};
}

describe("routeClineTask", () => {
	it("assigns the smallest sufficient model", () => {
		const decision = routeClineTask({
			difficulty: 40,
			fitBudgetTokens: 8_000,
			candidates: [
				{
					entry: createEntry({ key: "local:small:default", capability: 45, contextWindow: 16_000 }),
					role: "worker",
				},
				{
					entry: createEntry({ key: "cloud:large:default", capability: 90, contextWindow: 200_000 }),
					role: "architect",
				},
			],
		});

		expect(decision).toMatchObject({
			type: "assign",
			modelKey: "local:small:default",
			role: "worker",
		});
	});

	it("routes up when the preferred model is unrealistic", () => {
		const decision = routeClineTask({
			difficulty: 70,
			fitBudgetTokens: 12_000,
			preferredModelKey: "local:small:default",
			candidates: [
				{
					entry: createEntry({ key: "local:small:default", capability: 45, contextWindow: 16_000 }),
					role: "worker",
				},
				{
					entry: createEntry({ key: "cloud:large:default", capability: 90, contextWindow: 200_000 }),
					role: "architect",
				},
			],
		});

		expect(decision).toMatchObject({
			type: "route_up",
			modelKey: "cloud:large:default",
			fromModelKey: "local:small:default",
		});
	});

	it("keeps a feasible preferred model instead of routing down to the cheapest fit", () => {
		const decision = routeClineTask({
			difficulty: 40,
			fitBudgetTokens: 8_000,
			preferredModelKey: "cloud:large:default",
			candidates: [
				{
					entry: createEntry({ key: "local:small:default", capability: 45, contextWindow: 16_000 }),
					role: "worker",
				},
				{
					entry: createEntry({ key: "cloud:large:default", capability: 90, contextWindow: 200_000 }),
					role: "architect",
				},
			],
		});

		expect(decision).toMatchObject({
			type: "assign",
			modelKey: "cloud:large:default",
			role: "architect",
		});
	});

	it("can assign an 8k model when the prompt fits that candidate's own reserves", () => {
		const decision = routeClineTask({
			difficulty: 35,
			fitBudgetTokens: 80_000,
			promptTokens: 1_000,
			candidates: [
				{
					entry: createEntry({ key: "local:tiny:default", capability: 45, contextWindow: 8_000 }),
					role: "worker",
				},
				{
					entry: createEntry({ key: "cloud:large:default", capability: 90, contextWindow: 200_000 }),
					role: "architect",
				},
			],
		});

		expect(decision).toMatchObject({
			type: "assign",
			modelKey: "local:tiny:default",
		});
	});

	it("uses predicted speed as a tie-breaker after capability and cost", () => {
		const decision = routeClineTask({
			difficulty: 50,
			fitBudgetTokens: 8_000,
			promptTokens: 4_000,
			outputTokens: 400,
			candidates: [
				{
					entry: createEntry({
						key: "local:slow:default",
						capability: 60,
						contextWindow: 16_000,
						prefillTokensPerSecond: 500,
						decodeTokensPerSecond: 20,
					}),
					costRank: 1,
				},
				{
					entry: createEntry({
						key: "local:fast:default",
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
			modelKey: "local:fast:default",
		});
	});

	it("decomposes when no model satisfies both capability and context", () => {
		const decision = routeClineTask({
			difficulty: 70,
			fitBudgetTokens: 80_000,
			candidates: [
				{ entry: createEntry({ key: "local:smart-small-window:default", capability: 80, contextWindow: 16_000 }) },
				{ entry: createEntry({ key: "cloud:large-weak:default", capability: 40, contextWindow: 200_000 }) },
			],
		});

		expect(decision).toMatchObject({
			type: "decompose",
			requiredCapability: 70,
			requiredContextWindow: 80_000,
		});
	});

	it("escalates when no connected model is capable or large enough", () => {
		const decision = routeClineTask({
			difficulty: 90,
			fitBudgetTokens: 200_000,
			candidates: [
				{ entry: createEntry({ key: "local:small:default", capability: 45, contextWindow: 16_000 }) },
				{ entry: createEntry({ key: "cloud:mid:default", capability: 70, contextWindow: 80_000 }) },
			],
		});

		expect(decision).toMatchObject({
			type: "escalate",
			requiredCapability: 90,
			requiredContextWindow: 200_000,
		});
	});
});
