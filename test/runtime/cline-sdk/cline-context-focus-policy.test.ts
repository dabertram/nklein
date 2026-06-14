import { describe, expect, it } from "vitest";

import { compactKanbanFocusedMessages } from "../../../src/cline-sdk/cline-context-focus-policy";
import type { ClineSdkPersistedMessage } from "../../../src/cline-sdk/sdk-runtime-boundary";

function createReadFilesMessages(input: {
	toolUseId: string;
	path: string;
	startLine: number;
	endLine: number;
	content: string;
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
});
