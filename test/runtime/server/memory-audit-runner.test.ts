import { describe, expect, it } from "vitest";
import type { LmsPsModel } from "../../../src/core/lms-ps-json";
import type { NKleinModelRegistrySnapshot } from "../../../src/nklein-agent/nklein-model-registry";
import { selectStrongestNonAuthorMemoryAuditor } from "../../../src/server/memory-audit-runner";

function model(identifier: string, modelKey: string, contextLength = 40_000): LmsPsModel {
	return {
		identifier,
		modelKey,
		indexedModelIdentifier: null,
		path: null,
		machineId: "local",
		isEmbedding: false,
		status: "idle",
		queued: 0,
		parallel: 1,
		trainedForToolUse: true,
		contextLength,
	};
}

function registry(scores: Record<string, number>): NKleinModelRegistrySnapshot {
	return {
		schemaVersion: 1,
		updatedAt: 1,
		models: Object.fromEntries(
			Object.entries(scores).map(([modelId, score]) => [
				modelId,
				{
					modelId,
					updatedAt: 1,
					contextWindow: { effective: 40_000 },
					capability: { effectiveScore: score },
					speed: { wallTimeMsEwma: null },
				},
			]),
		),
	} as NKleinModelRegistrySnapshot;
}

describe("selectStrongestNonAuthorMemoryAuditor", () => {
	it("chooses the strongest idle ≥32k model and excludes the author through its real model-key alias", () => {
		const selected = selectStrongestNonAuthorMemoryAuditor({
			models: [
				model("author-alias", "publisher/author"),
				model("strong", "publisher/strong"),
				model("weak", "publisher/weak"),
			],
			descriptors: [],
			registry: registry({ "author-alias": 99, strong: 90, weak: 50 }),
			authorModelKey: "publisher/author",
		});
		expect(selected?.modelId).toBe("strong");
	});

	it("fails closed when every non-author model is busy or below the context floor", () => {
		const busy = { ...model("busy", "busy"), status: "processing" };
		expect(
			selectStrongestNonAuthorMemoryAuditor({
				models: [busy, model("short", "short", 4_096)],
				descriptors: [],
				registry: registry({ busy: 90, short: 80 }),
				authorModelKey: null,
			}),
		).toBeNull();
	});
});
