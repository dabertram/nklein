import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryClineMessageRepository } from "../../../src/cline-sdk/cline-message-repository";
import type { ClinePersistedTaskSessionSnapshot } from "../../../src/cline-sdk/cline-session-runtime";
import {
	type ClineTaskSessionEntry,
	createDefaultSummary,
	createMessage,
	setClineLostHeartbeatPolicy,
	updateSummary,
} from "../../../src/cline-sdk/cline-session-state";

function createPersistedSnapshot(
	messages: NonNullable<ClinePersistedTaskSessionSnapshot>["messages"],
): ClinePersistedTaskSessionSnapshot {
	return {
		record: {
			sessionId: "task-1-abc123",
			source: "core" as ClinePersistedTaskSessionSnapshot["record"]["source"],
			status: "completed",
			startedAt: "2026-03-17T10:00:00.000Z",
			updatedAt: "2026-03-17T10:05:00.000Z",
			interactive: true,
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/repo",
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			isSubagent: false,
		},
		messages,
	};
}

function createEntry(taskId: string): ClineTaskSessionEntry {
	return {
		summary: createDefaultSummary(taskId),
		messages: [],
		activeAssistantMessageId: null,
		activeReasoningMessageId: null,
		toolMessageIdByToolCallId: new Map<string, string>(),
		toolInputByToolCallId: new Map<string, unknown>(),
	};
}

describe("InMemoryClineMessageRepository", () => {
	beforeEach(() => {
		setClineLostHeartbeatPolicy("park");
	});

	it("parks running sessions for review when their heartbeat is lost", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "running";
		entry.summary.latestHookActivity = {
			activityText: "Agent active",
			toolName: null,
			toolInputSummary: null,
			finalMessage: "Generated a draft plan.",
			hookEventName: "assistant_delta",
			notificationType: null,
			source: "cline-sdk",
		};

		const summary = updateSummary(entry, {
			heartbeatStatus: "lost",
			lastHeartbeatAt: 123,
		});

		expect(summary.state).toBe("awaiting_review");
		expect(summary.reviewReason).toBe("error");
		expect(summary.warningMessage).toContain("heartbeat was lost");
		expect(summary.latestHookActivity?.finalMessage).toBe("Generated a draft plan.");
		expect(entry.summary.state).toBe("awaiting_review");
	});

	it("allows explicit running transitions to keep a lost heartbeat visible", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "awaiting_review";
		entry.summary.reviewReason = "hook";

		const summary = updateSummary(entry, {
			state: "running",
			reviewReason: null,
			heartbeatStatus: "lost",
		});

		expect(summary.state).toBe("running");
		expect(summary.heartbeatStatus).toBe("lost");
		expect(summary.reviewReason).toBeNull();
	});

	it("keeps running sessions active when the lost heartbeat policy allows it", () => {
		setClineLostHeartbeatPolicy("keep_running");
		const entry = createEntry("task-1");
		entry.summary.state = "running";

		const summary = updateSummary(entry, {
			heartbeatStatus: "lost",
			lastHeartbeatAt: 123,
		});

		expect(summary.state).toBe("running");
		expect(summary.heartbeatStatus).toBe("lost");
		expect(summary.reviewReason).toBeNull();
		expect(summary.warningMessage).toBeNull();
	});

	it("hydrates persisted SDK history into Kanban chat messages and caches the result", async () => {
		const repository = createInMemoryClineMessageRepository();
		const loadPersistedSession = vi.fn(async () =>
			createPersistedSnapshot([
				{
					role: "user",
					content: "Investigate startup",
				},
				{
					role: "assistant",
					content: [
						{
							type: "thinking",
							thinking: "Inspecting logs",
						},
						{
							type: "tool_use",
							id: "tool-1",
							name: "read_file",
							input: {
								path: "src/index.ts",
							},
						},
						{
							type: "text",
							text: "I found the issue.",
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: "console.log('ready')",
						},
					],
				},
			]),
		);

		const firstLoad = await repository.hydrateTaskMessages("task-1", loadPersistedSession);
		const secondLoad = await repository.hydrateTaskMessages("task-1", loadPersistedSession);

		expect(firstLoad.map((message) => ({ role: message.role, content: message.content }))).toEqual([
			{
				role: "user",
				content: "Investigate startup",
			},
			{
				role: "reasoning",
				content: "Inspecting logs",
			},
			{
				role: "tool",
				content: 'Tool: read_file\nInput:\n{\n  "path": "src/index.ts"\n}\nOutput:\nconsole.log(\'ready\')',
			},
			{
				role: "assistant",
				content: "I found the issue.",
			},
		]);
		expect(secondLoad).toEqual(firstLoad);
		expect(repository.listMessages("task-1")).toEqual(firstLoad);
		expect(loadPersistedSession).toHaveBeenCalledTimes(1);
	});

	it("prefers live in-memory task entries over persisted history hydration", async () => {
		const repository = createInMemoryClineMessageRepository();
		const entry = createEntry("task-1");
		entry.messages.push(createMessage("task-1", "assistant", "Live response"));
		repository.setTaskEntry("task-1", entry);
		const loadPersistedSession = vi.fn(async () =>
			createPersistedSnapshot([
				{
					role: "assistant",
					content: "Persisted response",
				},
			]),
		);

		const messages = await repository.hydrateTaskMessages("task-1", loadPersistedSession);

		expect(messages.map((message) => message.content)).toEqual(["Live response"]);
		expect(loadPersistedSession).not.toHaveBeenCalled();
	});

	it("drops hydrated message cache when explicitly cleared", async () => {
		const repository = createInMemoryClineMessageRepository();
		const loadPersistedSession = vi
			.fn()
			.mockResolvedValueOnce(
				createPersistedSnapshot([
					{
						role: "assistant",
						content: "Persisted response",
					},
				]),
			)
			.mockResolvedValueOnce(null);

		expect(
			(await repository.hydrateTaskMessages("task-1", loadPersistedSession)).map((message) => message.content),
		).toEqual(["Persisted response"]);
		repository.clearHydratedTaskMessages("task-1");
		expect(await repository.hydrateTaskMessages("task-1", loadPersistedSession)).toEqual([]);
		expect(loadPersistedSession).toHaveBeenCalledTimes(2);
	});
});
