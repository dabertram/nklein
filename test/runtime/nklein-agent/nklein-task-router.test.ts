import { describe, expect, it } from "vitest";
import type { NKleinModelRegistryEntry } from "../../../src/nklein-agent/nklein-model-registry";
import { routeNKleinTask } from "../../../src/nklein-agent/nklein-task-router";

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

	it("uses a caller-supplied predicted wall time as the cold-speed tiebreaker", () => {
		const decision = routeNKleinTask({
			difficulty: 40,
			fitBudgetTokens: 8_000,
			candidates: [
				{
					entry: createEntry({ key: "lmstudio:slow-equal:default", capability: 50, contextWindow: 32_000 }),
					role: "worker",
					predictedWallTimeMs: 80_000,
				},
				{
					entry: createEntry({ key: "lmstudio:fast-equal:default", capability: 50, contextWindow: 32_000 }),
					role: "worker",
					predictedWallTimeMs: 10_000,
				},
			],
		});

		expect(decision).toMatchObject({
			type: "assign",
			modelKey: "lmstudio:fast-equal:default",
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

	it("uses observedCapability (ledger-blended) over the registry score for feasibility (§5.AF live consumption)", () => {
		// Registry says the small model clears difficulty 50, but its ledger-observed capability is only 30 ⇒ it is no
		// longer feasible and routing escalates to the wider model instead of assigning the small one.
		const decision = routeNKleinTask({
			difficulty: 50,
			fitBudgetTokens: 8_000,
			preferredModelKey: "ollama:small:default",
			candidates: [
				{
					entry: createEntry({ key: "ollama:small:default", capability: 60, contextWindow: 16_000 }),
					role: "worker",
					observedCapability: 30,
				},
				{
					entry: createEntry({ key: "lmstudio:wide:default", capability: 80, contextWindow: 80_000 }),
					role: "architect",
					observedCapability: 80,
				},
			],
		});
		expect(decision).toMatchObject({ type: "route_up", modelKey: "lmstudio:wide:default" });
	});

	it("falls back to the registry score when observedCapability is null/undefined (no ledger evidence)", () => {
		const decision = routeNKleinTask({
			difficulty: 40,
			fitBudgetTokens: 8_000,
			candidates: [
				{
					entry: createEntry({ key: "ollama:small:default", capability: 45, contextWindow: 16_000 }),
					role: "worker",
					observedCapability: null,
				},
				{ entry: createEntry({ key: "openrouter:large:default", capability: 90, contextWindow: 200_000 }) },
			],
		});
		// Unchanged from the baseline "smallest sufficient" assignment.
		expect(decision).toMatchObject({ type: "assign", modelKey: "ollama:small:default" });
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

	it("prefers a tag-matching model among equally-capable feasible candidates (best-fit before smallest-sufficient)", () => {
		// Both clear difficulty 50 with identical capability; `a-general` sorts first by key, so WITHOUT affinity it wins.
		const candidates = [
			{
				entry: createEntry({ key: "lmstudio:a-general:default", capability: 60, contextWindow: 40_000 }),
				affinityTags: ["instruct"],
			},
			{
				entry: createEntry({ key: "lmstudio:z-coder:default", capability: 60, contextWindow: 40_000 }),
				affinityTags: ["code"],
			},
		];
		// No task tags ⇒ smallest-sufficient tie-break (key order) picks the general model — back-compat.
		expect(routeNKleinTask({ difficulty: 50, fitBudgetTokens: 8_000, candidates })).toMatchObject({
			modelKey: "lmstudio:a-general:default",
		});
		// A code card ⇒ the `code` model wins despite the worse key order.
		expect(
			routeNKleinTask({ difficulty: 50, fitBudgetTokens: 8_000, candidates, taskAffinityTags: ["code"] }),
		).toMatchObject({ type: "assign", modelKey: "lmstudio:z-coder:default" });
	});

	it("affinity never overrides feasibility — an INCAPABLE tag-match is not chosen", () => {
		const decision = routeNKleinTask({
			difficulty: 70,
			fitBudgetTokens: 8_000,
			taskAffinityTags: ["code"],
			candidates: [
				// tag matches but capability 50 < difficulty 70 → infeasible
				{
					entry: createEntry({ key: "lmstudio:weak-coder:default", capability: 50, contextWindow: 40_000 }),
					affinityTags: ["code"],
				},
				// no tag match but capable enough → the only feasible one
				{
					entry: createEntry({ key: "lmstudio:strong-general:default", capability: 80, contextWindow: 40_000 }),
					affinityTags: ["instruct"],
				},
			],
		});
		expect(decision).toMatchObject({ type: "assign", modelKey: "lmstudio:strong-general:default" });
	});

	it("prefers higher tag OVERLAP when several feasible candidates match", () => {
		const decision = routeNKleinTask({
			difficulty: 50,
			fitBudgetTokens: 8_000,
			taskAffinityTags: ["code", "agentic"],
			candidates: [
				{
					entry: createEntry({ key: "lmstudio:a-one-tag:default", capability: 60, contextWindow: 40_000 }),
					affinityTags: ["code"], // overlap 1
				},
				{
					entry: createEntry({ key: "lmstudio:z-two-tags:default", capability: 60, contextWindow: 40_000 }),
					affinityTags: ["code", "agentic"], // overlap 2 — wins despite worse key order
				},
			],
		});
		expect(decision).toMatchObject({ modelKey: "lmstudio:z-two-tags:default" });
	});

	describe("best-effort capability margin (§5.AB deadlock fix)", () => {
		it("bridges the one-point cliff: a card just above the fleet's prior is assigned best-effort, not frozen", () => {
			// The live deadlock: every model sits at the default prior 35, a card scores difficulty 36 → no strictly
			// feasible model → previously `decompose` (frozen board, nothing can decompose it either).
			const decision = routeNKleinTask({
				difficulty: 36,
				fitBudgetTokens: 8_000,
				candidates: [
					{ entry: createEntry({ key: "lmstudio:prior35:default", capability: 35, contextWindow: 32_000 }) },
				],
			});
			expect(decision).toMatchObject({ type: "assign", modelKey: "lmstudio:prior35:default" });
			expect((decision as { reason: string }).reason).toContain("best-effort");
		});

		it("still decomposes a genuinely-too-hard card (capability gap beyond the margin)", () => {
			const decision = routeNKleinTask({
				difficulty: 70,
				fitBudgetTokens: 8_000,
				candidates: [
					{ entry: createEntry({ key: "lmstudio:weak:default", capability: 45, contextWindow: 32_000 }) },
				],
			});
			// 70 - 45 = 25 > margin (15) → not bridged.
			expect(decision).toMatchObject({ type: "decompose" });
		});

		it("does NOT best-effort a model that cannot hold the context window (escalates instead)", () => {
			const decision = routeNKleinTask({
				difficulty: 36,
				fitBudgetTokens: 40_000, // required window exceeds the only candidate's 8k window
				promptTokens: 30_000,
				candidates: [
					{ entry: createEntry({ key: "lmstudio:tiny-ctx:default", capability: 35, contextWindow: 8_000 }) },
				],
			});
			// No model fits the window → no best-effort candidate; and none is capable → escalate.
			expect(decision).toMatchObject({ type: "escalate" });
		});

		it("picks the STRONGEST context-fitting model within the margin", () => {
			const decision = routeNKleinTask({
				difficulty: 40,
				fitBudgetTokens: 8_000,
				candidates: [
					{ entry: createEntry({ key: "lmstudio:cap30:default", capability: 30, contextWindow: 32_000 }) },
					{ entry: createEntry({ key: "lmstudio:cap34:default", capability: 34, contextWindow: 32_000 }) },
				],
			});
			// Neither clears 40; both within margin (40-34=6, 40-30=10) → strongest (34) wins.
			expect(decision).toMatchObject({ type: "assign", modelKey: "lmstudio:cap34:default" });
		});

		it("honors a pinned model for best-effort when it qualifies (context-fit + within margin)", () => {
			const decision = routeNKleinTask({
				difficulty: 40,
				fitBudgetTokens: 8_000,
				preferredModelKey: "lmstudio:pinned:default",
				candidates: [
					{ entry: createEntry({ key: "lmstudio:pinned:default", capability: 32, contextWindow: 32_000 }) },
					{ entry: createEntry({ key: "lmstudio:stronger:default", capability: 34, contextWindow: 32_000 }) },
				],
			});
			// The pinned model (32) is within margin (40-32=8) and fits context → assigned even though 34 is stronger.
			expect(decision).toMatchObject({ type: "assign", modelKey: "lmstudio:pinned:default" });
		});
	});
});
