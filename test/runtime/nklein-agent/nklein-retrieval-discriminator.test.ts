import { describe, expect, it, vi } from "vitest";
import { isMeasuredRetrievalDiscriminatorModel } from "../../../src/core/retrieval-discriminator";
import type { LocalLlmCompletionRequest } from "../../../src/nklein-agent/nklein-local-llm-client";
import { createLocalModelRetrievalDiscriminator } from "../../../src/nklein-agent/nklein-retrieval-discriminator";

describe("measured local retrieval discriminator", () => {
	it("enables only independently measured safe model identities", () => {
		expect(isMeasuredRetrievalDiscriminatorModel("qwen/qwen2.5-coder-14b")).toBe(true);
		expect(isMeasuredRetrievalDiscriminatorModel(" QWEN/QWEN3.6-35B-A3B ")).toBe(true);
		expect(isMeasuredRetrievalDiscriminatorModel("qwen3.5-9b-mlx-m4")).toBe(false);
		expect(isMeasuredRetrievalDiscriminatorModel("unknown-70b")).toBe(false);
	});

	it("sends task context plus the actual search query through strict bounded JSON", async () => {
		const captured: LocalLlmCompletionRequest[] = [];
		const complete = vi.fn(async (request: LocalLlmCompletionRequest) => {
			captured.push(request);
			return {
				content: '{"ranked_ids":["hit-1"],"keep_ids":["hit-1"]}',
				finishReason: "stop",
				raw: null,
			};
		});
		const discriminate = createLocalModelRetrievalDiscriminator({ complete });
		await expect(
			discriminate({
				taskContext: "Fix the session ledger path.",
				searchQuery: "workspace hash",
				candidates: [
					{ id: "hit-0", text: "unrelated adapter" },
					{ id: "hit-1", text: "hashWorkspacePathForLedger" },
				],
			}),
		).resolves.toEqual({ rankedIds: ["hit-1"], keepIds: ["hit-1"] });
		expect(captured[0]?.messages[1]?.content).toContain("Fix the session ledger path.");
		expect(captured[0]?.messages[1]?.content).toContain("SEARCH QUERY: workspace hash");
		expect(captured[0]?.sampling).toEqual({ temperature: 0, maxTokens: 1_024 });
		expect(captured[0]?.format?.jsonSchema?.strict).toBe(true);
	});
});
