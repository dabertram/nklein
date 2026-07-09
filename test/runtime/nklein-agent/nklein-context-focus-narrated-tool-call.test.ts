import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createKanbanContextFocusExtension } from "../../../src/nklein-agent/nklein-context-focus-extension";
import type { AgentAfterModelContext, AgentBeforeModelContext } from "../../../src/nklein-agent/sdk-agent-types";

const TEMP_PREFIX = "nklein-context-focus-narrated-";

function snapshot(iteration = 1): AgentBeforeModelContext["snapshot"] {
	return {
		agentId: "agent-1",
		status: "running",
		iteration,
		messages: [],
		pendingToolCalls: [],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
	};
}

function beforeModelContext(tools: AgentBeforeModelContext["request"]["tools"]): AgentBeforeModelContext {
	return {
		snapshot: snapshot(),
		request: {
			messages: [],
			tools,
		},
	};
}

function afterModelContext(text: string): AgentAfterModelContext {
	return {
		snapshot: snapshot(),
		assistantMessage: {
			id: "assistant-1",
			role: "assistant",
			content: [{ type: "text", text }],
			createdAt: Date.now(),
		},
		finishReason: "stop",
	};
}

describe("createKanbanContextFocusExtension narrated tool-call recovery", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.map((path) => rm(path, { recursive: true, force: true })));
		tempDirs.length = 0;
	});

	it("recovers a polluted narrated MCP tool name to the effective offered tool", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const extension = createKanbanContextFocusExtension("session-1", "/workspaces/task-1", workspacePath);

		await extension.hooks?.beforeModel?.(
			beforeModelContext([
				{
					name: "sequential-thinking__sequentialthinking",
					description: "Structured scratchpad",
					inputSchema: {},
				},
				{ name: "read_files", description: "Read files", inputSchema: {} },
			]),
		);

		const context = afterModelContext(
			`<function=sequential_thinking_sequentialthinking_1>{"thought":"split it","nextThoughtNeeded":false,"thoughtNumber":1,"totalThoughts":1}</function>`,
		);
		await extension.hooks?.afterModel?.(context);

		expect(context.assistantMessage.content).toContainEqual(
			expect.objectContaining({
				type: "tool-call",
				toolName: "sequential-thinking__sequentialthinking",
				input: { thought: "split it", nextThoughtNeeded: false, thoughtNumber: 1, totalThoughts: 1 },
				metadata: { recoveredFromNarratedToolCall: true },
			}),
		);
	});
});
