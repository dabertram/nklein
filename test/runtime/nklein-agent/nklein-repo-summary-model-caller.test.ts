import { describe, expect, it, vi } from "vitest";
import type { StructuredGenerator } from "../../../src/nklein-agent/klein-core-client";
import type { RepoSummaryRequest } from "../../../src/nklein-agent/nklein-hierarchical-repo-summary";
import type { LocalLlmClient } from "../../../src/nklein-agent/nklein-local-llm-client";
import { createLocalRepoSummaryModelCaller } from "../../../src/nklein-agent/nklein-repo-summary-model-caller";

const REQUESTS: RepoSummaryRequest[] = [
	{ id: "function:src/a.ts:run:1", kind: "function", name: "run", path: "src/a.ts", evidence: "function run() {}" },
];

describe("local repo-summary model caller", () => {
	it("prefers a required native tool call for reasoning models that dead-end json_schema", async () => {
		const generateStructured = vi.fn(async () => {
			throw new Error("should not use response_format when the native call succeeds");
		});
		const completeWithTools = vi.fn(async () => ({
			content: "",
			toolCalls: [
				{
					id: "call-1",
					name: "repo_node_summaries",
					arguments: { summaries: [{ id: REQUESTS[0]?.id, summary: "Runs the primary operation." }] },
				},
			],
			finishReason: "tool_calls",
			raw: null,
		}));
		const caller = createLocalRepoSummaryModelCaller({
			generateStructured,
			completeWithTools,
		} as unknown as LocalLlmClient);

		const result = await caller(REQUESTS);

		expect(result.get(REQUESTS[0]?.id ?? "")).toBe("Runs the primary operation.");
		expect(completeWithTools).toHaveBeenCalledOnce();
		const nativeCall = completeWithTools.mock.calls[0] as unknown as [unknown, unknown, unknown];
		expect(nativeCall[2]).toEqual({ toolChoice: "required" });
		expect(generateStructured).not.toHaveBeenCalled();
	});

	it("falls back to constrained generation when native arguments are incomplete", async () => {
		const completeWithTools = vi.fn(async () => ({
			content: "",
			toolCalls: [{ id: "call-1", name: "repo_node_summaries", arguments: { summaries: [] } }],
			finishReason: "tool_calls",
			raw: null,
		}));
		const generateStructured: StructuredGenerator["generateStructured"] = vi.fn(async (input) =>
			input.parse({ summaries: [{ id: REQUESTS[0]?.id, summary: "Fallback summary." }] }),
		);
		const caller = createLocalRepoSummaryModelCaller({ generateStructured, completeWithTools });

		const result = await caller(REQUESTS);

		expect(result.get(REQUESTS[0]?.id ?? "")).toBe("Fallback summary.");
		expect(generateStructured).toHaveBeenCalledOnce();
	});
});
