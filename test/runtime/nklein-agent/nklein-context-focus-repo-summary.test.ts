import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createKanbanContextFocusExtension } from "../../../src/nklein-agent/nklein-context-focus-extension";
import {
	type RepoSummaryModelCaller,
	refreshHierarchicalRepoSummary,
} from "../../../src/nklein-agent/nklein-hierarchical-repo-summary";
import type {
	AgentAfterToolContext,
	AgentBeforeModelContext,
	AgentMessage,
} from "../../../src/nklein-agent/sdk-agent-types";

function modelContext(messages: readonly AgentMessage[] = []): AgentBeforeModelContext {
	return {
		snapshot: {
			agentId: "agent-1",
			status: "running",
			iteration: 1,
			messages,
			pendingToolCalls: [],
			usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
		},
		request: { messages, tools: [] },
	};
}

function successfulWriteContext(): AgentAfterToolContext {
	const toolCall = { type: "tool-call" as const, toolCallId: "write-1", toolName: "write_file", input: {} };
	return {
		snapshot: modelContext().snapshot,
		tool: {
			name: "write_file",
			description: "write",
			inputSchema: { type: "object" },
			execute: async () => ({}),
		},
		toolCall,
		input: {},
		result: { output: {}, isError: false },
		startedAt: new Date(0),
		endedAt: new Date(1),
		durationMs: 1,
	};
}

function railText(messages: readonly AgentMessage[] | undefined): string {
	const rail = messages?.find((message) => message.metadata?.kind === "kanban_repo_map_rail");
	const part = rail?.content.find((candidate) => candidate.type === "text");
	return part?.type === "text" ? part.text : "";
}

describe("context-focus hierarchical repo summary", () => {
	it("never hides a cold full-repository build in beforeModel", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "nklein-cold-context-repo-summary-"));
		await writeFile(join(workspacePath, "feature.ts"), "export function feature() { return true; }\n", "utf8");
		let calls = 0;
		const summarize: RepoSummaryModelCaller = async (requests) => {
			calls += 1;
			return new Map(requests.map((request) => [request.id, request.name]));
		};
		const extension = createKanbanContextFocusExtension(
			"cold-summary-session",
			workspacePath,
			workspacePath,
			40_000,
			undefined,
			undefined,
			undefined,
			undefined,
			summarize,
		);

		const result = await extension.hooks?.beforeModel?.(modelContext());

		expect(calls).toBe(0);
		expect(railText(result?.messages)).not.toContain("Hierarchical repository summary");
	});

	it("injects the local artifact and replaces a stale rail after a successful edit", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "nklein-context-repo-summary-"));
		const sourcePath = join(workspacePath, "feature.ts");
		await writeFile(sourcePath, "export function oldFeature() { return true; }\n", "utf8");
		const summarize: RepoSummaryModelCaller = async (requests) =>
			new Map(requests.map((request) => [request.id, `${request.kind} summary for ${request.name}`]));
		await refreshHierarchicalRepoSummary({ workspacePath, summarize });
		const extension = createKanbanContextFocusExtension(
			"summary-session",
			workspacePath,
			workspacePath,
			40_000,
			undefined,
			undefined,
			undefined,
			undefined,
			summarize,
		);

		const initial = await extension.hooks?.beforeModel?.(modelContext());
		const initialText = railText(initial?.messages);
		expect(initialText).toContain("Hierarchical repository summary");
		expect(initialText).toContain("function summary for oldFeature");
		expect(initialText).toContain("untrusted orientation");

		await writeFile(sourcePath, "export function newFeature() { return true; }\n", "utf8");
		await extension.hooks?.afterTool?.(successfulWriteContext());
		const refreshed = await extension.hooks?.beforeModel?.(modelContext(initial?.messages));
		const refreshedText = railText(refreshed?.messages);
		expect(refreshed?.messages?.filter((message) => message.metadata?.kind === "kanban_repo_map_rail")).toHaveLength(
			1,
		);
		expect(refreshedText).toContain("function summary for newFeature");
		expect(refreshedText).not.toContain("function summary for oldFeature");
	});
});
