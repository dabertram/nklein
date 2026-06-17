import type { AgentAfterModelContext } from "@clinebot/shared";
import { describe, expect, it } from "vitest";

import { reviewClineAfterModelCompletion } from "../../../src/cline-sdk/cline-self-review-hook";

function createAfterModelContext(text: string): AgentAfterModelContext {
	return {
		snapshot: {
			agentId: "agent-1",
			status: "running",
			iteration: 1,
			messages: [],
			pendingToolCalls: [],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		},
		assistantMessage: {
			id: "assistant-1",
			role: "assistant",
			content: [{ type: "text", text }],
			createdAt: Date.now(),
		},
		finishReason: "stop",
	};
}

describe("cline self-review hook", () => {
	it("blocks final answers that admit unfinished work", () => {
		const control = reviewClineAfterModelCompletion(
			createAfterModelContext("The main change is complete, but there is still a TODO remaining in the parser."),
		);

		expect(control).toMatchObject({
			stop: true,
		});
		expect(control?.reason).toContain("self-review blocked completion");
	});

	it("blocks contradictory completion claims without changes", () => {
		const control = reviewClineAfterModelCompletion(
			createAfterModelContext("Done. No files were changed because the implementation was already fine."),
		);

		expect(control).toMatchObject({
			stop: true,
		});
	});

	it("allows ordinary final summaries", () => {
		const control = reviewClineAfterModelCompletion(
			createAfterModelContext("Implemented the parser fix and added focused regression coverage."),
		);

		expect(control).toBeUndefined();
	});

	it("ignores assistant turns that contain tool calls", () => {
		const context = createAfterModelContext("TODO remaining.");
		context.assistantMessage.content = [
			{
				type: "tool-call",
				toolCallId: "tool-1",
				toolName: "read_files",
				input: {},
			},
		];

		expect(reviewClineAfterModelCompletion(context)).toBeUndefined();
	});
});
