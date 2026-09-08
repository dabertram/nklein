import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryNKleinMessageRepository } from "../../../src/nklein-agent/nklein-message-repository";
import type { NKleinPersistedTaskSessionSnapshot } from "../../../src/nklein-agent/nklein-session-runtime";
import {
	createDefaultSummary,
	createMessage,
	type NKleinTaskSessionEntry,
	setNKleinLostHeartbeatPolicy,
	updateSummary,
} from "../../../src/nklein-agent/nklein-session-state";

function createPersistedSnapshot(
	messages: NonNullable<NKleinPersistedTaskSessionSnapshot>["messages"],
): NKleinPersistedTaskSessionSnapshot {
	return {
		record: {
			sessionId: "task-1-abc123",
			source: "core" as NKleinPersistedTaskSessionSnapshot["record"]["source"],
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

function createEntry(taskId: string): NKleinTaskSessionEntry {
	return {
		summary: createDefaultSummary(taskId),
		messages: [],
		activeAssistantMessageId: null,
		activeReasoningMessageId: null,
		toolMessageIdByToolCallId: new Map<string, string>(),
		toolInputByToolCallId: new Map<string, unknown>(),
	};
}

describe("InMemoryNKleinMessageRepository", () => {
	beforeEach(() => {
		setNKleinLostHeartbeatPolicy("park");
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
			source: "nklein-sdk",
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
		setNKleinLostHeartbeatPolicy("keep_running");
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

	it("hydrates persisted SDK history into !Klein chat messages and caches the result", async () => {
		const repository = createInMemoryNKleinMessageRepository();
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
							name: "read_files",
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
		const repository = createInMemoryNKleinMessageRepository();
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
		const repository = createInMemoryNKleinMessageRepository();
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

describe("emitSummary write-through (N21)", () => {
	// Live-hit 2026-08-02, twice, two different warning texts: emitSummary was fanout-only, so the event
	// adapter's terminal `awaiting_review` reached every listener while `entry.summary` still said `running`
	// from turn start. The next warning-only `updateSummary(entry, …)` spread the stale state wholesale and
	// RESURRECTED `running` — yanking the card out of review with the warning text as the transition reason.
	it("persists the emitted summary so getSummary returns it", () => {
		const repository = createInMemoryNKleinMessageRepository();
		const entry = createEntry("task-n21");
		repository.setTaskEntry("task-n21", entry);
		repository.emitSummary({ ...entry.summary, state: "awaiting_review", reviewReason: "hook" });
		expect(repository.getSummary("task-n21")?.state).toBe("awaiting_review");
	});

	it("survives the adapter-terminal-then-warning sequence without resurrecting the stale state", () => {
		const repository = createInMemoryNKleinMessageRepository();
		const entry = createEntry("task-n21");
		repository.setTaskEntry("task-n21", entry);
		updateSummary(entry, { state: "running" });

		// The adapter's terminal emit (it builds its summary elsewhere — only the emit reaches this store).
		repository.emitSummary({ ...entry.summary, state: "awaiting_review", reviewReason: "hook" });

		// The start-warning continuation, ~350ms later: a warning-only patch onto the SAME entry. Before the
		// write-through, entry.summary still said "running" and this spread re-emitted it.
		const emitted = updateSummary(entry, { warningMessage: "Sandbox MCP server withheld …" });
		expect(emitted.state).toBe("awaiting_review");
		expect(emitted.warningMessage).toBe("Sandbox MCP server withheld …");
	});

	it("ignores an emit for a task with no entry (no phantom entries)", () => {
		const repository = createInMemoryNKleinMessageRepository();
		const orphan = createEntry("task-elsewhere");
		expect(() => repository.emitSummary(orphan.summary)).not.toThrow();
		expect(repository.getSummary("task-elsewhere")).toBeNull();
	});
});

describe("InMemoryNKleinMessageRepository — the retention budget (P0.HEAP)", () => {
	/**
	 * The repository kept every session's transcript mirror for the life of the process. The server died at its
	 * heap limit twice — 4 GB on 2026-09-02 and 24.5 GB on 2026-09-07, 9.7 hours in. The persisted SDK session is
	 * the durable truth; a settled card's in-memory transcript is a cache, and beyond a budget it is dropped.
	 */
	// The settled states are `failed`, `interrupted` and `idle`. `awaiting_review` is deliberately NOT settled: a
	// reviewer still reads that transcript, and the failover path reads a just-failed one to build the carry
	// prompt — which is also why the budget is enforced on the next session start, not on the settling summary.
	function settledEntry(taskId: string, updatedAt: number): NKleinTaskSessionEntry {
		const entry = createEntry(taskId);
		entry.summary.state = "idle";
		entry.summary.updatedAt = updatedAt;
		entry.messages = [{ id: `${taskId}-m1`, role: "assistant", content: "x".repeat(1000), createdAt: updatedAt }];
		return entry;
	}

	it("drops the least-recently-updated settled transcripts beyond the budget, keeping the summary", () => {
		const repository = createInMemoryNKleinMessageRepository({ maxSettledTranscripts: 2 });
		for (const [index, taskId] of ["oldest", "middle", "newest"].entries()) {
			repository.setTaskEntry(taskId, settledEntry(taskId, 1_000 + index));
		}
		// The budget is enforced on the NEXT set, which is when the map grows. This entry must be genuinely LIVE:
		// a default entry is `idle`, which is itself a settled state and would push another transcript out.
		const live = createEntry("live");
		live.summary.state = "running";
		repository.setTaskEntry("live", live);

		expect(repository.listMessages("oldest")).toEqual([]);
		expect(repository.getSummary("oldest")?.state).toBe("idle");
		expect(repository.listMessages("newest")).toHaveLength(1);
		expect(repository.listMessages("middle")).toHaveLength(1);
	});

	it("never drops a transcript that is still live, whatever the budget says", () => {
		const repository = createInMemoryNKleinMessageRepository({ maxSettledTranscripts: 0 });
		const running = createEntry("running");
		running.summary.state = "running";
		running.messages = [{ id: "running-m1", role: "assistant", content: "live", createdAt: 1 }];
		repository.setTaskEntry("running", running);
		repository.setTaskEntry("other", createEntry("other"));
		expect(repository.listMessages("running")).toHaveLength(1);
	});

	it("reports what it is holding, so the climb is visible before the fatal line is", () => {
		const repository = createInMemoryNKleinMessageRepository({ maxSettledTranscripts: 1 });
		repository.setTaskEntry("a", settledEntry("a", 1));
		repository.setTaskEntry("b", settledEntry("b", 2));
		repository.setTaskEntry("c", settledEntry("c", 3));
		const footprint = repository.getFootprint();
		expect(footprint.taskEntries).toBe(3);
		// Budget 1 over three settled entries: two transcripts released, one still held.
		expect(footprint.releasedTranscripts).toBe(2);
		expect(footprint.transcriptMessages).toBe(1);
		expect(footprint.transcriptChars).toBe(1000);
		expect(footprint.hydratedTranscripts).toBe(0);
	});
});
