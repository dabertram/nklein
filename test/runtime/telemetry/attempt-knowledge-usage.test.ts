import { describe, expect, it } from "vitest";
import { summarizeAttemptKnowledgeUsage } from "../../../src/telemetry/attempt-knowledge-usage";

const call = (name: string, outcome: "success" | "error" | null = "success") => ({
	name,
	fingerprint: `${name}-fp`,
	outcome,
});

describe("summarizeAttemptKnowledgeUsage (F1.1)", () => {
	it("counts retrieval vs localization calls and collects distinct sorted categories", () => {
		const summary = summarizeAttemptKnowledgeUsage([
			call("search_code"), // code_index (retrieval)
			call("search_code"), // code_index again
			call("architecture_knowledge"), // architecture_knowledge (retrieval)
			call("list_files"), // file_discovery (localization)
			call("read_files"), // file_read (localization)
			call("write_file"), // other — ignored
			call("decompose_project"), // planning_control — ignored
		]);
		expect(summary).toEqual({
			retrievalCallCount: 3,
			localizationCallCount: 2,
			knowledgeErrorCount: 0,
			categoriesUsed: ["architecture_knowledge", "code_index", "file_discovery", "file_read"],
		});
	});

	it("tallies errored knowledge calls and returns an empty summary for a knowledge-free attempt", () => {
		expect(summarizeAttemptKnowledgeUsage([call("search_code", "error"), call("read_files", "error")])).toMatchObject(
			{
				retrievalCallCount: 1,
				localizationCallCount: 1,
				knowledgeErrorCount: 2,
			},
		);
		expect(summarizeAttemptKnowledgeUsage([call("write_file"), call("run_command")])).toEqual({
			retrievalCallCount: 0,
			localizationCallCount: 0,
			knowledgeErrorCount: 0,
			categoriesUsed: [],
		});
	});
});
