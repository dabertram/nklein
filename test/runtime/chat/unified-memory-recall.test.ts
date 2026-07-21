import { describe, expect, it } from "vitest";
import type { ChatMemory } from "../../../src/chat/chat-memory-store";
import { recallUnifiedMemoryBand } from "../../../src/chat/unified-memory-recall";
import { buildInternalLongMemoryEvalFixture, evaluateLongMemoryBenchmark } from "../../../src/core/long-memory-eval";

function memory(input: Partial<ChatMemory> & Pick<ChatMemory, "id" | "sessionId" | "text">): ChatMemory {
	return {
		schemaVersion: 1,
		shared: false,
		embedding: null,
		createdAt: 1,
		...input,
	};
}

describe("recallUnifiedMemoryBand", () => {
	it("runs chat recall and every supplied source through the production projection + bounded band", async () => {
		const result = await recallUnifiedMemoryBand({
			query: "postgres retry",
			sessionId: "driver",
			allProjects: true,
			chatMemories: [
				memory({
					id: "hit",
					sessionId: "other",
					text: "Postgres retries use exponential backoff.",
					namespaceId: "atlas",
					namespaceLabel: "Atlas",
				}),
				memory({
					id: "miss",
					sessionId: "other",
					text: "Unrelated color preference.",
					namespaceId: "atlas",
					namespaceLabel: "Atlas",
				}),
			],
			basicMemorySources: [
				{
					permalink: "db/operations",
					title: "Database operations",
					body: "Postgres retry runbook",
					namespaceId: "atlas",
					namespaceLabel: "Atlas",
				},
			],
			defaultNamespaceId: "atlas",
			focusChainSteps: [{ step: "verify retries", status: "in_progress" }],
			bandOptions: { maxRecords: 3, perSourceFloor: 1 },
		});

		expect(result.recalledSessionMemories.map((entry) => entry.id)).toEqual(["hit"]);
		expect(result.rankedBasicMemoryNotes.map((entry) => entry.permalink)).toEqual(["db/operations"]);
		expect(result.band.map((entry) => entry.source).sort()).toEqual(["basic_memory", "focus_chain", "session"]);
	});

	it("does not cross session boundaries unless the evidence-gated caller explicitly requests it", async () => {
		const chatMemories = [
			memory({
				id: "foreign",
				sessionId: "other",
				text: "Postgres retry runbook",
				namespaceId: "atlas",
				namespaceLabel: "Atlas",
			}),
		];
		const scoped = await recallUnifiedMemoryBand({ query: "postgres retry", sessionId: "driver", chatMemories });
		const broadened = await recallUnifiedMemoryBand({
			query: "postgres retry",
			sessionId: "driver",
			chatMemories,
			allProjects: true,
			defaultNamespaceId: "atlas",
		});
		expect(scoped.band).toEqual([]);
		expect(broadened.band.map((entry) => entry.id)).toEqual(["session:foreign"]);
	});

	it("withholds the entire widened band when its evidence-bound embedding profile is unavailable", async () => {
		const result = await recallUnifiedMemoryBand(
			{
				query: "postgres retry",
				sessionId: "driver",
				allProjects: true,
				chatMemories: [
					memory({
						id: "foreign",
						sessionId: "other",
						text: "Postgres retry runbook",
						embedding: [1, 0],
						embeddingModelId: "embed-v1",
					}),
				],
				basicMemorySources: [{ permalink: "foreign/runbook", title: "Postgres", body: "Postgres retry runbook" }],
				focusChainSteps: [{ step: "verify retries", status: "in_progress" }],
			},
			{
				embed: async () => null,
				embeddingModelId: "embed-v1",
				requireEmbedding: true,
			},
		);
		expect(result).toEqual({
			recalledSessionMemories: [],
			rankedBasicMemoryNotes: [],
			candidates: [],
			band: [],
		});
	});

	it("passes every internal LongMemEval retrieval dimension through the exact production composer", async () => {
		const fixture = buildInternalLongMemoryEvalFixture();
		const selected = new Map<string, string[]>();
		for (const case_ of fixture) {
			const chatMemories = case_.memories.map((entry) =>
				memory({
					id: entry.id,
					sessionId: entry.sessionId,
					text: entry.text,
					createdAt: entry.recordedAt,
					namespaceId: entry.namespace,
					namespaceLabel: entry.namespace.replace(/^ws-/u, ""),
				}),
			);
			for (const prompt of case_.prompts) {
				const result = await recallUnifiedMemoryBand({
					query: prompt.query,
					sessionId: "driver",
					chatMemories,
					allProjects: true,
					chatMemoryLimit: 2,
					bandOptions: { maxRecords: 2, perSourceFloor: 0 },
				});
				selected.set(
					`${case_.id}:${prompt.id}`,
					result.band.map((entry) => entry.id.replace(/^session:/u, "")),
				);
			}
		}
		const report = evaluateLongMemoryBenchmark(
			fixture,
			({ case_, prompt }) => selected.get(`${case_.id}:${prompt.id}`) ?? [],
			{ k: 2 },
		);
		expect(report).toMatchObject({
			passed: true,
			recallAtK: 1,
			abstainAccuracy: 1,
			dimensionPassRate: { relevance: 1, contradiction: 1, privacy: 1, recency: 1 },
		});
	});
});
