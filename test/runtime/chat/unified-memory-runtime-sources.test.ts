import { describe, expect, it } from "vitest";
import type { ChatMemory } from "../../../src/chat/chat-memory-store";
import { loadUnifiedMemoryRuntimeSources } from "../../../src/chat/unified-memory-runtime-sources";
import type { RuntimeWorkspaceIndexEntry } from "../../../src/state/workspace-state";

const memory: ChatMemory = {
	schemaVersion: 1,
	id: "legacy",
	sessionId: "alpha-chat",
	shared: false,
	text: "alpha fact",
	embedding: null,
	createdAt: 1,
};

const entries: RuntimeWorkspaceIndexEntry[] = [
	{
		workspaceId: "alpha",
		repoPath: "/repos/alpha",
		displayName: "Project Alpha",
		gitRepositoryCreatedByKanban: false,
		selfProjectConfirmed: true,
		autoResumeEnabled: false,
	},
	{
		workspaceId: "beta",
		repoPath: "/repos/beta",
		displayName: null,
		gitRepositoryCreatedByKanban: false,
		selfProjectConfirmed: true,
		autoResumeEnabled: false,
	},
];

function deps(readRoots: string[]) {
	return {
		readChatMemories: async () => [memory],
		listChatSessions: async () => [
			{
				schemaVersion: 1 as const,
				id: "alpha-chat",
				title: "Project Alpha",
				scope: "project_sandboxed" as const,
				role: "planner_architect" as const,
				goal: null,
				riskAcknowledged: false,
				browserEnabled: false,
				sandboxWritablePaths: [],
				feedbackMuted: false,
				feedbackVerbosity: "normal" as const,
				feedbackQuiet: false,
				ownedWorkspaceId: "alpha",
				focus: null,
				outstandingAsks: [],
				selectedSkillIds: [],
				totalTokensUsed: 0,
				taintLabels: [],
				createdAt: 1,
				updatedAt: 1,
			},
		],
		listWorkspaceEntries: async () => entries,
		readBasicMemorySources: async (root: string) => {
			readRoots.push(root);
			return [{ permalink: root, title: "note", body: "body" }];
		},
	};
}

describe("loadUnifiedMemoryRuntimeSources", () => {
	it("reads only the active project plus global and enriches legacy chat-memory ownership", async () => {
		const roots: string[] = [];
		const result = await loadUnifiedMemoryRuntimeSources(
			{
				runtimeHome: "/runtime",
				activeWorkspaceId: "alpha",
				activeWorkspacePath: "/repos/alpha",
				accessAllProjects: false,
			},
			deps(roots),
		);
		expect(roots).toHaveLength(2);
		expect(roots).toContain("/runtime/basic-memory/global/notes");
		expect(roots.some((root) => root.endsWith("/notes") && !root.includes("global"))).toBe(true);
		expect(result.chatMemories[0]).toMatchObject({ namespaceId: "alpha", namespaceLabel: "Project Alpha" });
		expect(result.basicMemorySources.map((source) => source.namespaceId).sort()).toEqual(["alpha", "global"]);
	});

	it("reads every registered project only after the caller authorizes broadening", async () => {
		const roots: string[] = [];
		const result = await loadUnifiedMemoryRuntimeSources(
			{
				runtimeHome: "/runtime",
				activeWorkspaceId: "alpha",
				activeWorkspacePath: "/repos/alpha",
				accessAllProjects: true,
			},
			deps(roots),
		);
		expect(roots).toHaveLength(3);
		expect(result.basicMemorySources.map((source) => source.namespaceId).sort()).toEqual(["alpha", "beta", "global"]);
		expect(result.namespaceHints).toEqual([
			{ id: "alpha", label: "Project Alpha", aliases: ["alpha"] },
			{ id: "beta", label: "beta", aliases: ["beta"] },
		]);
	});
});
