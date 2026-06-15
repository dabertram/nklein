import { describe, expect, it } from "vitest";

import {
	compactKanbanFocusedMessages,
	compactKanbanMessagesForContextTarget,
	countKanbanPersistedMessagesTokens,
	focusKanbanReadFilesForNextRequest,
} from "../../../src/cline-sdk/cline-context-focus-policy";
import type { ClineSdkPersistedMessage } from "../../../src/cline-sdk/sdk-runtime-boundary";

function createReadFilesMessages(input: {
	toolUseId: string;
	path: string;
	startLine: number;
	endLine: number;
	content: string;
	isError?: boolean;
	toolName?: "read_files" | "read_large_file";
}): ClineSdkPersistedMessage[] {
	return [
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: input.toolUseId,
					name: input.toolName ?? "read_files",
					input:
						input.toolName === "read_large_file"
							? { path: input.path }
							: {
									files: [
										{
											path: input.path,
											start_line: input.startLine,
											end_line: input.endLine,
										},
									],
								},
				},
			],
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: input.toolUseId,
					content: input.content,
					...(input.isError ? { is_error: true } : {}),
				},
			],
		},
	];
}

function getToolResultContent(messages: readonly ClineSdkPersistedMessage[], toolUseId: string): string | null {
	for (const message of messages) {
		if (typeof message.content === "string") {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_result" && block.tool_use_id === toolUseId) {
				return typeof block.content === "string"
					? block.content
					: block.content
							.map((contentBlock) => (contentBlock.type === "text" ? contentBlock.text : ""))
							.join("\n");
			}
		}
	}
	return null;
}

describe("compactKanbanFocusedMessages", () => {
	it("retains the newest read_files result and summarizes older chunks before the next model request", async () => {
		const olderChunk = "old chunk line\n".repeat(2_000);
		const latestChunk = "latest chunk must remain verbatim\n".repeat(20);
		const messages: ClineSdkPersistedMessage[] = [
			{ role: "user", content: "Please inspect this file in chunks." },
			...createReadFilesMessages({
				toolUseId: "read-1",
				path: "src/large.ts",
				startLine: 1,
				endLine: 1_000,
				content: olderChunk,
			}),
			...createReadFilesMessages({
				toolUseId: "read-2",
				path: "src/large.ts",
				startLine: 1_001,
				endLine: 2_000,
				content: latestChunk,
			}),
		];

		const result = await compactKanbanFocusedMessages({
			agentId: "agent-1",
			conversationId: "conversation-1",
			parentAgentId: null,
			iteration: 3,
			messages,
			model: {
				id: "claude-sonnet-4-6",
				provider: "anthropic",
			},
			contextWindowTokens: 80_000,
			triggerTokens: 64_000,
			thresholdRatio: 0.8,
			utilizationRatio: 0.9,
		});

		expect(result).toBeDefined();
		const compactedText = JSON.stringify(result?.messages);
		expect(compactedText).toContain("previous read_files result compacted");
		expect(compactedText).toContain("src/large.ts:1-1000");
		expect(compactedText).toContain("src/large.ts:1001-2000");
		expect(compactedText).toContain("latest raw result retained for immediate analysis");
		expect(compactedText).toContain("Per-file read coverage");
		expect(compactedText).toContain("covered ranges 1-2000; next unread line 2001");
		expect(compactedText).toContain("Do not restart a file from line 1");
		expect(compactedText).not.toContain(olderChunk.trim());
		expect(getToolResultContent(result?.messages ?? [], "read-2")).toBe(latestChunk);
	});

	it("keeps earlier chunk bodies out of the current chunk context", () => {
		const firstChunk = "first raw source chunk\n".repeat(7_500);
		const secondChunk = "second raw source chunk\n".repeat(7_500);
		const messages: ClineSdkPersistedMessage[] = [
			{ role: "user", content: "Extract the full specification from this large file." },
			{
				role: "user",
				content:
					"/Users/david/.cline/worktrees/19cc2/bla2/card1_raw_discussion.txt\n" +
					"/Users/david/.cline/worktrees/19cc2/bla2/card2_raw_discussion.txt\n" +
					"/Users/david/.cline/worktrees/19cc2/bla2/card3_raw_discussion.txt\n" +
					"/Users/david/.cline/worktrees/19cc2/bla2/plan.md",
			},
			...createReadFilesMessages({
				toolUseId: "read-1",
				path: "card1_raw_discussion.txt",
				startLine: 1,
				endLine: 2_500,
				content: firstChunk,
			}),
			{ role: "assistant", content: "Read the first chunk; continuing with the next range." },
			...createReadFilesMessages({
				toolUseId: "read-2",
				path: "card1_raw_discussion.txt",
				startLine: 2_501,
				endLine: 5_000,
				content: secondChunk,
			}),
		];

		const compactedMessages = compactKanbanMessagesForContextTarget(messages, 60_000);

		expect(compactedMessages).not.toBeNull();
		const compactedText = JSON.stringify(compactedMessages);
		expect(compactedText).toContain("card1_raw_discussion.txt:1-2500");
		expect(compactedText).toContain("card1_raw_discussion.txt:2501-5000");
		expect(compactedText).toContain("previous read_files result compacted");
		expect(compactedText).toContain("Known existing paths observed in this session");
		expect(compactedText).toContain("card2_raw_discussion.txt");
		expect(compactedText).toContain("card3_raw_discussion.txt");
		expect(compactedText).toContain("plan.md");
		expect(compactedText).not.toContain(firstChunk.trim());
		expect(getToolResultContent(compactedMessages ?? [], "read-2")).toBe(secondChunk);
		expect(countKanbanPersistedMessagesTokens(compactedMessages ?? [])).toBeLessThan(60_000);
	});

	it("focuses read chunks before every request without waiting for the compaction threshold", () => {
		const firstChunk = "first request chunk\n".repeat(100);
		const secondChunk = "second request chunk\n".repeat(100);
		const messages: ClineSdkPersistedMessage[] = [
			{ role: "user", content: "Read all chunks." },
			...createReadFilesMessages({
				toolUseId: "read-1",
				path: "src/large.ts",
				startLine: 1,
				endLine: 100,
				content: firstChunk,
			}),
			{ role: "assistant", content: "Recorded the first chunk." },
			...createReadFilesMessages({
				toolUseId: "read-2",
				path: "src/large.ts",
				startLine: 101,
				endLine: 200,
				content: secondChunk,
			}),
		];

		const focusedMessages = focusKanbanReadFilesForNextRequest(messages);

		expect(focusedMessages).not.toBeNull();
		expect(getToolResultContent(focusedMessages ?? [], "read-1")).toContain("previous read_files result compacted");
		expect(getToolResultContent(focusedMessages ?? [], "read-2")).toBe(secondChunk);
	});

	it("retains only the newest read_large_file output", () => {
		const firstChunk = "first large-file chunk\n".repeat(100);
		const secondChunk = "second large-file chunk\n".repeat(100);
		const messages: ClineSdkPersistedMessage[] = [
			{ role: "user", content: "Read the entire large file." },
			...createReadFilesMessages({
				toolUseId: "large-read-1",
				toolName: "read_large_file",
				path: "notes.txt",
				startLine: 1,
				endLine: 100,
				content: firstChunk,
			}),
			{ role: "assistant", content: "Recorded this chunk and continuing." },
			...createReadFilesMessages({
				toolUseId: "large-read-2",
				toolName: "read_large_file",
				path: "notes.txt",
				startLine: 101,
				endLine: 200,
				content: secondChunk,
			}),
		];

		const focusedMessages = focusKanbanReadFilesForNextRequest(messages);

		expect(getToolResultContent(focusedMessages ?? [], "large-read-1")).toContain(
			"previous read_files result compacted",
		);
		expect(getToolResultContent(focusedMessages ?? [], "large-read-2")).toBe(secondChunk);
	});

	it("reports gaps instead of treating noncontiguous reads as complete coverage", () => {
		const messages: ClineSdkPersistedMessage[] = [
			{ role: "user", content: "Read the file in ranges." },
			...createReadFilesMessages({
				toolUseId: "read-1",
				path: "src/gapped.ts",
				startLine: 1,
				endLine: 100,
				content: "first chunk\n".repeat(20),
			}),
			...createReadFilesMessages({
				toolUseId: "read-2",
				path: "src/gapped.ts",
				startLine: 201,
				endLine: 300,
				content: "third chunk\n".repeat(20),
			}),
		];

		const compactedMessages = compactKanbanMessagesForContextTarget(messages, 60_000);
		const compactedText = JSON.stringify(compactedMessages);

		expect(compactedText).toContain("covered ranges 1-100, 201-300; next unread line 101");
		expect(compactedText).not.toContain("next unread line 301");
	});

	it("falls back to an emergency summary when structured history remains over target", () => {
		const messages: ClineSdkPersistedMessage[] = [
			{ role: "user", content: "Inspect the attached material." },
			{
				role: "user",
				content: [
					{
						type: "file",
						path: "large.txt",
						content: "large structured content\n".repeat(10_000),
					},
				],
			},
		];

		const compactedMessages = compactKanbanMessagesForContextTarget(messages, 100);

		expect(compactedMessages).not.toBeNull();
		expect(countKanbanPersistedMessagesTokens(compactedMessages ?? [])).toBeLessThanOrEqual(100);
	});

	it("marks hallucinated missing read paths as invalid instead of known files", () => {
		const messages: ClineSdkPersistedMessage[] = [
			{ role: "user", content: "Extract specs from the known files." },
			{
				role: "user",
				content:
					"/Users/david/.cline/worktrees/19cc2/bla2/card1_raw_discussion.txt\n" +
					"/Users/david/.cline/worktrees/19cc2/bla2/plan.md",
			},
			...createReadFilesMessages({
				toolUseId: "read-ok",
				path: "/Users/david/.cline/worktrees/19cc2/bla2/card1_raw_discussion.txt",
				startLine: 1,
				endLine: 100,
				content: "real source chunk\n".repeat(10),
			}),
			{
				role: "assistant",
				content: "Trying /Users/david/.cline/worktrees/19cc2/bla2/specs.txt next.",
			},
			...createReadFilesMessages({
				toolUseId: "read-missing",
				path: "/Users/david/.cline/worktrees/19cc2/bla2/specs.txt",
				startLine: 1,
				endLine: 100,
				content:
					"Error reading file: ENOENT: no such file or directory, stat '/Users/david/.cline/worktrees/19cc2/bla2/specs.txt'",
				isError: true,
			}),
		];

		const compactedMessages = compactKanbanMessagesForContextTarget(messages, 60_000);

		expect(compactedMessages).not.toBeNull();
		const compactedText = JSON.stringify(compactedMessages);
		expect(compactedText).toContain("Known existing paths observed in this session");
		expect(compactedText).toContain("card1_raw_discussion.txt");
		expect(compactedText).toContain("plan.md");
		expect(compactedText).toContain("Invalid or missing read_files paths");
		expect(compactedText).toContain("specs.txt");
		expect(compactedText).toContain("Do not retry this path unless a directory listing confirms it exists");
	});
});
