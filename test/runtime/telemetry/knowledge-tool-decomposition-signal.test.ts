import { describe, expect, it } from "vitest";
import type { RuntimeKnowledgeToolUsageObservation } from "../../../src/core/api-contract";
import {
	aggregateDecompositionKnowledgeSignals,
	correlateDecompositionKnowledgeSignals,
	DEFAULT_KNOWLEDGE_DECOMPOSITION_CATEGORIES,
} from "../../../src/telemetry/knowledge-tool-decomposition-signal";

let counter = 0;
function obs(overrides: Partial<RuntimeKnowledgeToolUsageObservation>): RuntimeKnowledgeToolUsageObservation {
	counter += 1;
	return {
		schemaVersion: 1,
		id: `obs-${counter}`,
		recordedAt: 1000,
		appVersion: "0.0.1",
		workspaceId: "ws-1",
		workspacePathHash: "hashA",
		workspacePath: "/projects/alpha",
		projectName: "alpha",
		taskId: "task-1",
		taskTitle: "Build feature",
		role: "architect",
		roleSource: "card",
		providerId: "lmstudio",
		modelId: "qwen3-8b",
		toolName: "read_files",
		toolCategory: "file_read",
		outcome: "succeeded",
		hookEventName: "tool_result",
		toolInputSummary: null,
		activityText: null,
		lastHookAt: 1000,
		...overrides,
	};
}

const decomposeApplied = (recordedAt: number, overrides: Partial<RuntimeKnowledgeToolUsageObservation> = {}) =>
	obs({
		recordedAt,
		toolName: "decompose_project",
		toolCategory: "planning_control",
		hookEventName: "decomposition_applied",
		...overrides,
	});

describe("correlateDecompositionKnowledgeSignals", () => {
	it("flags a decomposition that consulted knowledge tools first", () => {
		const signals = correlateDecompositionKnowledgeSignals([
			obs({ recordedAt: 100, toolName: "search_code", toolCategory: "code_index", hookEventName: "tool_result" }),
			obs({ recordedAt: 120, toolName: "codebase_search", toolCategory: "codebase_retrieval" }),
			decomposeApplied(200),
		]);
		expect(signals).toHaveLength(1);
		expect(signals[0]).toMatchObject({
			taskId: "task-1",
			usedKnowledgeTools: true,
			applied: true,
			decomposedAt: 200,
			// JS default sort: "code_index" precedes "codebase_retrieval" ('_' 0x5F < 'b' 0x62).
			knowledgeCategoriesBefore: ["code_index", "codebase_retrieval"],
		});
	});

	it("flags a decomposition that did NOT consult knowledge tools (file reads don't count)", () => {
		const signals = correlateDecompositionKnowledgeSignals([
			obs({ recordedAt: 100, toolName: "read_files", toolCategory: "file_read" }),
			obs({ recordedAt: 110, toolName: "list_files", toolCategory: "file_discovery" }),
			decomposeApplied(200),
		]);
		expect(signals[0].usedKnowledgeTools).toBe(false);
		expect(signals[0].knowledgeCategoriesBefore).toEqual([]);
	});

	it("ignores knowledge tools used AFTER the decomposition landed", () => {
		const signals = correlateDecompositionKnowledgeSignals([
			decomposeApplied(200),
			obs({ recordedAt: 300, toolName: "codebase_search", toolCategory: "codebase_retrieval" }),
		]);
		expect(signals[0].usedKnowledgeTools).toBe(false);
	});

	it("credits knowledge work done between a rejected and a retried (applied) decomposition", () => {
		const signals = correlateDecompositionKnowledgeSignals([
			// First decompose attempt is rejected (only a tool call, no applied event yet).
			obs({
				recordedAt: 100,
				toolName: "decompose_project",
				toolCategory: "planning_control",
				hookEventName: "tool_call",
			}),
			obs({ recordedAt: 150, toolName: "search_code", toolCategory: "code_index" }),
			decomposeApplied(200),
		]);
		// Boundary anchors on the (latest) applied event at 200, so the code_index call at 150 counts.
		expect(signals[0]).toMatchObject({
			usedKnowledgeTools: true,
			applied: true,
			knowledgeCategoriesBefore: ["code_index"],
		});
	});

	it("falls back to the decompose_project call when there is no applied event", () => {
		const signals = correlateDecompositionKnowledgeSignals([
			obs({ recordedAt: 100, toolName: "codebase_search", toolCategory: "codebase_retrieval" }),
			obs({
				recordedAt: 200,
				toolName: "decompose_project",
				toolCategory: "planning_control",
				hookEventName: "tool_call",
			}),
		]);
		expect(signals[0]).toMatchObject({ applied: false, usedKnowledgeTools: true, decomposedAt: 200 });
	});

	it("produces no signal for a session that never decomposed", () => {
		const signals = correlateDecompositionKnowledgeSignals([
			obs({ recordedAt: 100, toolName: "codebase_search", toolCategory: "codebase_retrieval" }),
		]);
		expect(signals).toEqual([]);
	});

	it("dedups + sorts the knowledge categories before the decomposition", () => {
		const signals = correlateDecompositionKnowledgeSignals([
			obs({ recordedAt: 90, toolName: "codebase_search", toolCategory: "codebase_retrieval" }),
			obs({ recordedAt: 95, toolName: "codebase_search", toolCategory: "codebase_retrieval" }),
			obs({ recordedAt: 96, toolName: "architecture_knowledge", toolCategory: "architecture_knowledge" }),
			decomposeApplied(200),
		]);
		expect(signals[0].knowledgeCategoriesBefore).toEqual(["architecture_knowledge", "codebase_retrieval"]);
	});

	it("honours a custom knowledge-category set", () => {
		const observations = [
			obs({ recordedAt: 100, toolName: "read_files", toolCategory: "file_read" }),
			decomposeApplied(200),
		];
		expect(correlateDecompositionKnowledgeSignals(observations)[0].usedKnowledgeTools).toBe(false);
		const withFileReads = correlateDecompositionKnowledgeSignals(observations, {
			knowledgeCategories: new Set(["file_read"]),
		});
		expect(withFileReads[0].usedKnowledgeTools).toBe(true);
		expect(withFileReads[0].knowledgeCategoriesBefore).toEqual(["file_read"]);
	});

	it("returns one signal per task, newest decomposition first", () => {
		const signals = correlateDecompositionKnowledgeSignals([
			decomposeApplied(200, { taskId: "task-old" }),
			decomposeApplied(500, { taskId: "task-new" }),
		]);
		expect(signals.map((signal) => signal.taskId)).toEqual(["task-new", "task-old"]);
	});

	it("exposes the default knowledge categories (retrieval / index / architecture)", () => {
		expect([...DEFAULT_KNOWLEDGE_DECOMPOSITION_CATEGORIES].sort()).toEqual([
			"architecture_knowledge",
			"code_index",
			"codebase_retrieval",
		]);
	});
});

describe("aggregateDecompositionKnowledgeSignals", () => {
	it("rolls decompositions up per scope with a knowledge-usage rate", () => {
		const signals = correlateDecompositionKnowledgeSignals([
			// task-1: consulted knowledge.
			obs({ taskId: "task-1", recordedAt: 100, toolName: "search_code", toolCategory: "code_index" }),
			decomposeApplied(200, { taskId: "task-1" }),
			// task-2: did not.
			obs({ taskId: "task-2", recordedAt: 100, toolName: "read_files", toolCategory: "file_read" }),
			decomposeApplied(300, { taskId: "task-2" }),
		]);
		const aggregates = aggregateDecompositionKnowledgeSignals(signals);
		const overall = aggregates.find((aggregate) => aggregate.scope === "overall");
		expect(overall).toMatchObject({
			decompositions: 2,
			withKnowledgeTools: 1,
			withoutKnowledgeTools: 1,
			knowledgeUsageRate: 0.5,
			providerId: "lmstudio",
			modelId: "qwen3-8b",
			role: "architect",
			lastDecomposedAt: 300,
		});
		// One bucket per scope (overall/version/project) since provider/model/role/project all match.
		expect(new Set(aggregates.map((aggregate) => aggregate.scope))).toEqual(
			new Set(["overall", "version", "project"]),
		);
	});

	it("returns no aggregates for no signals", () => {
		expect(aggregateDecompositionKnowledgeSignals([])).toEqual([]);
	});
});
