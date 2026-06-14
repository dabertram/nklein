import { describe, expect, it } from "vitest";

import {
	compactKanbanFocusedMessages,
	compactKanbanMessagesForContextTarget,
} from "../../../src/cline-sdk/cline-context-focus-policy";
import type { ClineSdkPersistedMessage } from "../../../src/cline-sdk/sdk-runtime-boundary";

function createReadFilesMessages(input: {
	toolUseId: string;
	path: string;
	startLine: number;
	endLine: number;
	content: string;
	isError?: boolean;
}): ClineSdkPersistedMessage[] {
	return [
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: input.toolUseId,
					name: "read_files",
					input: {
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

describe("compactKanbanFocusedMessages", () => {
	it("summarizes older read_files results while preserving the latest chunk verbatim", async () => {
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
		const latestResultMessage = result?.messages[4];
		const latestResultContent =
			latestResultMessage && typeof latestResultMessage.content !== "string" ? latestResultMessage.content[0] : null;
		expect(compactedText).toContain("previous read_files result compacted");
		expect(compactedText).toContain("src/large.ts:1-1000");
		expect(compactedText).not.toContain(olderChunk.trim());
		expect(latestResultContent).toEqual(
			expect.objectContaining({
				type: "tool_result",
				tool_use_id: "read-2",
				content: latestChunk,
			}),
		);
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
		const latestResultContent = compactedMessages
			?.flatMap((message) => (typeof message.content === "string" ? [] : message.content))
			.find((block) => block.type === "tool_result" && block.tool_use_id === "read-2");
		expect(compactedText).toContain("card1_raw_discussion.txt:1-2500");
		expect(compactedText).toContain("previous read_files result compacted");
		expect(compactedText).toContain("Known existing paths observed in this session");
		expect(compactedText).toContain("card2_raw_discussion.txt");
		expect(compactedText).toContain("card3_raw_discussion.txt");
		expect(compactedText).toContain("plan.md");
		expect(compactedText).not.toContain(firstChunk.trim());
		expect(latestResultContent).toEqual(
			expect.objectContaining({
				type: "tool_result",
				tool_use_id: "read-2",
				content: secondChunk,
			}),
		);
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
